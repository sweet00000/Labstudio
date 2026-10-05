"""Unit tests for the API Lambda with moto S3 and a fake Batch client.
Run: python -m pytest aws/tests  (or python aws/tests/test_api.py)"""
import json, os, sys, types, urllib.request

os.environ.update(AWS_DEFAULT_REGION="us-east-1", AWS_REGION="us-east-1", AWS_ACCESS_KEY_ID="x", AWS_SECRET_ACCESS_KEY="x",
                  BUCKET="st-test", API_KEY="k" * 32, GPU_QUEUE="gpuq", CPU_QUEUE="cpuq", SPLAT_JOBDEF="sj", FOAM_JOBDEF="fj", BUDGET_NAME="b")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from moto import mock_aws


class FakeBatch:
    def __init__(self):
        self.state = "ENABLED"; self.jobs = {}; self.n = 0
    def describe_job_queues(self, jobQueues):
        return {"jobQueues": [{"jobQueueName": q, "state": self.state} for q in jobQueues]}
    def submit_job(self, **kw):
        self.n += 1; jid = f"batch-{self.n}"; self.jobs[jid] = {"jobId": jid, "status": "RUNNABLE", **kw}; return {"jobId": jid}
    def describe_jobs(self, jobs):
        return {"jobs": [self.jobs[j] for j in jobs if j in self.jobs]}
    def update_job_queue(self, jobQueue, state):
        self.state = state
    def list_jobs(self, jobQueue, jobStatus):
        return {"jobSummaryList": [{"jobId": j["jobId"]} for j in self.jobs.values() if j["status"] == jobStatus and j["jobQueue"] == jobQueue]}
    def terminate_job(self, jobId, reason):
        self.jobs[jobId]["status"] = "FAILED"; self.jobs[jobId]["statusReason"] = reason


def call(app, method, path, body=None, key="k" * 32):
    ev = {"requestContext": {"http": {"method": method}}, "rawPath": path, "headers": {"X-Api-Key": key} if key else {},
          "body": json.dumps(body) if body is not None else None}
    ctx = types.SimpleNamespace(invoked_function_arn="arn:aws:lambda:us-east-1:123456789012:function:f")
    r = app.handler(ev, ctx)
    return r["statusCode"], json.loads(r["body"])


@mock_aws
def test_flow():
    import importlib, boto3
    import app
    importlib.reload(app)
    app.batch = FakeBatch()
    app.budgets = types.SimpleNamespace(describe_budget=lambda **k: {"Budget": {"CalculatedSpend": {"ActualSpend": {"Amount": "12.5"}}, "BudgetLimit": {"Amount": "100"}}})
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="st-test")

    assert call(app, "GET", "/health", key="wrong")[0] == 401
    assert call(app, "GET", "/health", key=None)[0] == 401
    code, h = call(app, "GET", "/health")
    assert code == 200 and h["spend"] == {"actual": 12.5, "limit": 100.0} and h["paused"] is False

    assert call(app, "POST", "/jobs", {"type": "nope", "files": [{"name": "a"}]})[0] == 400
    assert call(app, "POST", "/jobs", {"type": "foam", "files": []})[0] == 400
    assert call(app, "POST", "/jobs", {"type": "foam", "files": [{"name": "a.stl", "size": 5 * 1024 ** 3}]})[0] == 400

    code, r = call(app, "POST", "/jobs", {"type": "foam", "files": [{"name": "../../body.stl", "size": 10}], "params": {"speed": 30}})
    assert code == 200, r
    jid, up = r["jobId"], r["uploads"][0]
    assert up["key"] == "body.stl" and "X-Amz-Signature" in up["url"]

    # start before upload -> refused
    assert call(app, "POST", f"/jobs/{jid}/start", {})[0] == 400
    s3.put_object(Bucket="st-test", Key=f"inputs/{jid}/body.stl", Body=b"solid x")
    code, j = call(app, "POST", f"/jobs/{jid}/start", {})
    assert code == 200 and j["status"] == "SUBMITTED"
    sub = app.batch.jobs[j["batchJobId"]]
    env = {e["name"]: e["value"] for e in sub["containerOverrides"]["environment"]}
    assert sub["jobQueue"] == "cpuq" and sub["jobDefinition"] == "fj" and env["JOB_ID"] == jid and json.loads(env["PARAMS"]) == {"speed": 30}
    assert call(app, "POST", f"/jobs/{jid}/start", {})[0] == 409  # no double start

    # finish the job and check the download links
    app.batch.jobs[j["batchJobId"]]["status"] = "SUCCEEDED"
    s3.put_object(Bucket="st-test", Key=f"outputs/{jid}/summary.json", Body=b"{}")
    code, j = call(app, "GET", f"/jobs/{jid}")
    assert j["status"] == "SUCCEEDED" and j["results"][0]["name"] == "summary.json" and "X-Amz-Signature" in j["results"][0]["url"]
    code, lst = call(app, "GET", "/jobs")
    assert code == 200 and lst["jobs"][0]["jobId"] == jid

    # duplicate names get prefixed, not overwritten
    code, r2 = call(app, "POST", "/jobs", {"type": "splat", "files": [{"name": "img.jpg"}, {"name": "img.jpg"}]})
    assert [u["key"] for u in r2["uploads"]] == ["img.jpg", "1_img.jpg"]

    # budget guard: pauses queues, terminates running work, API refuses new jobs
    s3.put_object(Bucket="st-test", Key=f"inputs/{r2['jobId']}/img.jpg", Body=b"x")
    s3.put_object(Bucket="st-test", Key=f"inputs/{r2['jobId']}/1_img.jpg", Body=b"x")
    code, j2 = call(app, "POST", f"/jobs/{r2['jobId']}/start", {})
    assert code == 200
    out = app.budget_guard({}, None)
    assert out["terminated"] == 1 and app.batch.state == "DISABLED"
    assert call(app, "GET", "/health")[1]["paused"] is True
    assert call(app, "POST", "/jobs", {"type": "foam", "files": [{"name": "a.stl"}]})[0] == 409
    assert call(app, "GET", "/nope")[0] == 404
    print("API tests passed")


if __name__ == "__main__":
    test_flow()

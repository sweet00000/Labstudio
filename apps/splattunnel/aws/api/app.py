"""Splat Tunnel API (AWS Lambda behind an HTTP API).

Routes (all need header x-api-key):
  GET  /health            region, spend vs budget, paused state
  GET  /jobs              recent jobs
  POST /jobs              {type: splat|foam, files:[{name,size}], params} -> presigned upload URLs
  POST /jobs/{id}/start   submit the AWS Batch job
  GET  /jobs/{id}         status, and download links when finished

Job records live in S3 (jobs/<id>.json), so there is no database to pay for.
A second handler, budget_guard, pauses everything when the budget alarm fires.
"""
import hmac, json, os, re, time, uuid

import boto3
from botocore.config import Config

REGION = os.environ.get("AWS_REGION", "us-east-1")
BUCKET = os.environ.get("BUCKET", "")
API_KEY = os.environ.get("API_KEY", "")
QUEUES = {"splat": os.environ.get("GPU_QUEUE", ""), "foam": os.environ.get("CPU_QUEUE", "")}
JOBDEFS = {"splat": os.environ.get("SPLAT_JOBDEF", ""), "foam": os.environ.get("FOAM_JOBDEF", "")}
BUDGET = os.environ.get("BUDGET_NAME", "")
MAX_FILES = 400
MAX_BYTES = 4 * 1024 ** 3
URL_TTL = 3600

s3 = boto3.client("s3", region_name=REGION, config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))
batch = boto3.client("batch", region_name=REGION)
budgets = boto3.client("budgets", region_name="us-east-1")


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body, default=str)}


def safe_name(n):
    n = os.path.basename(str(n)).strip().replace(" ", "_")
    n = re.sub(r"[^A-Za-z0-9._-]", "", n)[:120]
    return n or "file"


def load_job(jid):
    try:
        return json.loads(s3.get_object(Bucket=BUCKET, Key=f"jobs/{jid}.json")["Body"].read())
    except s3.exceptions.NoSuchKey:
        return None


def save_job(job):
    s3.put_object(Bucket=BUCKET, Key=f"jobs/{job['jobId']}.json", Body=json.dumps(job).encode(), ContentType="application/json")


def queues_paused():
    names = [q for q in QUEUES.values() if q]
    if not names:
        return False
    qs = batch.describe_job_queues(jobQueues=names)["jobQueues"]
    return any(q["state"] != "ENABLED" for q in qs)


def spend(account):
    if not BUDGET:
        return None
    try:
        b = budgets.describe_budget(AccountId=account, BudgetName=BUDGET)["Budget"]
        return {"actual": float(b["CalculatedSpend"]["ActualSpend"]["Amount"]), "limit": float(b["BudgetLimit"]["Amount"])}
    except Exception:  # budgets data can lag or be missing on new accounts
        return None


def refresh(job):
    """Pull status from Batch; attach presigned result links when done."""
    if job.get("batchJobId") and job["status"] not in ("SUCCEEDED", "FAILED"):
        d = batch.describe_jobs(jobs=[job["batchJobId"]])["jobs"]
        if d:
            job["status"] = d[0]["status"]
            job["reason"] = d[0].get("statusReason", "")
            save_job({k: v for k, v in job.items() if k != "results"})
    if job["status"] in ("SUCCEEDED", "FAILED"):
        res = []
        for o in s3.list_objects_v2(Bucket=BUCKET, Prefix=f"outputs/{job['jobId']}/").get("Contents", []):
            name = o["Key"].rsplit("/", 1)[-1]
            url = s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": o["Key"], "ResponseContentDisposition": f'attachment; filename="{name}"'}, ExpiresIn=URL_TTL)
            res.append({"name": name, "size": o["Size"], "url": url})
        job["results"] = res
    return job


def handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "/")
    if method == "OPTIONS":
        return resp(204, {})
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if not API_KEY or not hmac.compare_digest(headers.get("x-api-key", ""), API_KEY):
        return resp(401, {"error": "Wrong or missing access key."})
    try:
        body = json.loads(event.get("body") or "{}") if method == "POST" else {}
    except json.JSONDecodeError:
        return resp(400, {"error": "Request body isn't valid JSON."})
    account = context.invoked_function_arn.split(":")[4] if context else ""

    if path == "/health":
        return resp(200, {"ok": True, "region": REGION, "paused": queues_paused(), "spend": spend(account)})

    if path == "/jobs" and method == "GET":
        objs = s3.list_objects_v2(Bucket=BUCKET, Prefix="jobs/").get("Contents", [])
        objs.sort(key=lambda o: o["LastModified"], reverse=True)
        jobs = [load_job(o["Key"][5:-5]) for o in objs[:20]]
        return resp(200, {"jobs": [refresh(j) for j in jobs if j]})

    if path == "/jobs" and method == "POST":
        jtype = body.get("type")
        if jtype not in QUEUES:
            return resp(400, {"error": "Job type must be splat or foam."})
        files = body.get("files") or []
        if not files or len(files) > MAX_FILES:
            return resp(400, {"error": f"Send between 1 and {MAX_FILES} files."})
        if sum(int(f.get("size") or 0) for f in files) > MAX_BYTES:
            return resp(400, {"error": "Uploads are limited to 4 GB per job."})
        if queues_paused():
            return resp(409, {"error": "Jobs are paused because the budget cap was reached."})
        jid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        names, uploads = set(), []
        for f in files:
            n = safe_name(f.get("name"))
            base, i = n, 1
            while n in names:
                n = f"{i}_{base}"; i += 1
            names.add(n)
            url = s3.generate_presigned_url("put_object", Params={"Bucket": BUCKET, "Key": f"inputs/{jid}/{n}"}, ExpiresIn=URL_TTL)
            uploads.append({"name": f.get("name"), "key": n, "url": url})
        params = body.get("params") or {}
        job = {"jobId": jid, "type": jtype, "status": "CREATED", "created": int(time.time() * 1000), "params": params, "files": sorted(names)}
        save_job(job)
        return resp(200, {"jobId": jid, "uploads": uploads})

    m = re.fullmatch(r"/jobs/([A-Za-z0-9-]+)(/start)?", path)
    if m:
        job = load_job(m.group(1))
        if not job:
            return resp(404, {"error": "No job with that id."})
        if m.group(2) and method == "POST":
            if job["status"] != "CREATED":
                return resp(409, {"error": "This job was already started."})
            got = {o["Key"].rsplit("/", 1)[-1] for o in s3.list_objects_v2(Bucket=BUCKET, Prefix=f"inputs/{job['jobId']}/").get("Contents", [])}
            missing = [n for n in job["files"] if n not in got]
            if missing:
                return resp(400, {"error": f"{len(missing)} file(s) haven't finished uploading."})
            r = batch.submit_job(
                jobName=f"{job['type']}-{job['jobId']}",
                jobQueue=QUEUES[job["type"]],
                jobDefinition=JOBDEFS[job["type"]],
                containerOverrides={"environment": [
                    {"name": "JOB_ID", "value": job["jobId"]},
                    {"name": "BUCKET", "value": BUCKET},
                    {"name": "PARAMS", "value": json.dumps(job.get("params") or {})},
                ]},
            )
            job.update(batchJobId=r["jobId"], status="SUBMITTED")
            save_job(job)
            return resp(200, job)
        if method == "GET":
            return resp(200, refresh(job))
    return resp(404, {"error": "Unknown route."})


def budget_guard(event, context):
    """SNS from AWS Budgets at the cap: stop spending immediately."""
    stopped = 0
    for q in [q for q in QUEUES.values() if q]:
        batch.update_job_queue(jobQueue=q, state="DISABLED")
        for status in ("SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"):
            for j in batch.list_jobs(jobQueue=q, jobStatus=status).get("jobSummaryList", []):
                batch.terminate_job(jobId=j["jobId"], reason="Budget cap reached")
                stopped += 1
    print(json.dumps({"paused": True, "terminated": stopped}))
    return {"paused": True, "terminated": stopped}

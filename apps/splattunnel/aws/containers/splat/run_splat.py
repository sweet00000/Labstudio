#!/usr/bin/env python3
"""Photos or a video -> COLMAP poses -> gsplat (nerfstudio splatfacto) -> splat .ply

Cloud mode (AWS Batch): env JOB_ID, BUCKET, PARAMS. Inputs from
s3://BUCKET/inputs/JOB_ID/, results to s3://BUCKET/outputs/JOB_ID/.
Local mode: run_splat.py --local ./photos --out ./results
PARAMS: steps (default 7000; 30000 for best quality), max_frames (video, default 200)
"""
import argparse, glob, json, os, shutil, subprocess, sys, time, zipfile

VIDEO = (".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def run(cmd, logf):
    log("$", " ".join(cmd))
    with open(logf, "a") as f:
        f.write("\n$ " + " ".join(cmd) + "\n")
        f.flush()
        r = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]} failed; see log.txt\n" + open(logf).read()[-2500:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local")
    ap.add_argument("--out", default="results")
    ap.add_argument("--work", default="/tmp/job")
    a = ap.parse_args()
    params = json.loads(os.environ.get("PARAMS") or "{}")
    steps = int(params.get("steps", 7000))
    shutil.rmtree(a.work, ignore_errors=True)
    raw = os.path.join(a.work, "raw")
    os.makedirs(raw)
    logf = os.path.join(a.work, "log.txt")
    s3 = None
    if a.local:
        for f in os.listdir(a.local):
            shutil.copy(os.path.join(a.local, f), raw)
        out = a.out
    else:
        import boto3
        s3 = boto3.client("s3")
        bucket, job = os.environ["BUCKET"], os.environ["JOB_ID"]
        pages = s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"inputs/{job}/")
        for page in pages:
            for o in page.get("Contents", []):
                s3.download_file(bucket, o["Key"], os.path.join(raw, os.path.basename(o["Key"])))
        out = os.path.join(a.work, "out")
    os.makedirs(out, exist_ok=True)
    proc = os.path.join(a.work, "proc")
    try:
        files = sorted(os.listdir(raw))
        videos = [f for f in files if f.lower().endswith(VIDEO)]
        if videos:
            run(["ns-process-data", "video", "--data", os.path.join(raw, videos[0]), "--output-dir", proc,
                 "--num-frames-target", str(int(params.get("max_frames", 200)))], logf)
        else:
            run(["ns-process-data", "images", "--data", raw, "--output-dir", proc], logf)
        train = os.path.join(a.work, "train")
        run(["ns-train", "splatfacto", "--data", proc, "--output-dir", train,
             "--max-num-iterations", str(steps), "--vis", "tensorboard",
             "--viewer.quit-on-train-completion", "True"], logf)
        cfgs = glob.glob(os.path.join(train, "**", "config.yml"), recursive=True)
        if not cfgs:
            raise RuntimeError("training finished without a config.yml")
        export = os.path.join(a.work, "export")
        run(["ns-export", "gaussian-splat", "--load-config", sorted(cfgs)[-1], "--output-dir", export], logf)
        plys = glob.glob(os.path.join(export, "*.ply"))
        if not plys:
            raise RuntimeError("export produced no .ply")
        shutil.copy(plys[0], os.path.join(out, "splat.ply"))
        # camera poses, handy for re-training elsewhere
        tj = os.path.join(proc, "transforms.json")
        if os.path.exists(tj):
            shutil.copy(tj, os.path.join(out, "transforms.json"))
        json.dump({"steps": steps, "inputs": len(files), "video": bool(videos)}, open(os.path.join(out, "summary.json"), "w"))
        log("done")
    finally:
        if os.path.exists(logf):
            shutil.copy(logf, os.path.join(out, "log.txt"))
        if s3:
            for fn in os.listdir(out):
                s3.upload_file(os.path.join(out, fn), bucket, f"outputs/{job}/{fn}")


if __name__ == "__main__":
    main()

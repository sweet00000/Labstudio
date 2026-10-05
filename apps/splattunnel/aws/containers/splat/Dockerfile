# nerfstudio's official image: CUDA, COLMAP, GLOMAP, gsplat, ffmpeg. Supports T4 (g4dn) and A10G (g5).
FROM ghcr.io/nerfstudio-project/nerfstudio:latest
USER root
RUN pip install --no-cache-dir boto3
COPY run_splat.py /opt/run_splat.py
ENTRYPOINT ["python3", "/opt/run_splat.py"]

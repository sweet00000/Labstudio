# OpenFOAM v2512 (openfoam.com) on Ubuntu 24.04, installed from the official apt repo.
FROM public.ecr.aws/ubuntu/ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-boto3 \
 && curl -fsSL https://dl.openfoam.com/add-debian-repo.sh | bash \
 && apt-get update \
 && apt-get install -y --no-install-recommends openfoam2512-default \
 && rm -rf /var/lib/apt/lists/*
ENV FOAM_BASHRC=/usr/lib/openfoam/openfoam2512/etc/bashrc \
    OMPI_ALLOW_RUN_AS_ROOT=1 OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1
COPY run_foam.py /opt/run_foam.py
ENTRYPOINT ["python3", "/opt/run_foam.py"]

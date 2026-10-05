#!/usr/bin/env bash
# Deploy the Splat Tunnel backend into your AWS account.
# Easiest place to run it: AWS CloudShell (it already has the aws CLI and zip).
#
#   ./deploy.sh you@example.com                # first deploy
#   BUDGET=60 ORIGIN=https://webelves.us ./deploy.sh you@example.com
#   ./deploy.sh --rebuild-images               # push new container code only
#
# Env: STACK (default splattunnel), AWS_REGION (default us-east-1), BUDGET (USD/month, default 100),
#      ORIGIN (site allowed to call the API, default *), GPU_MAX_VCPUS (8), CPU_MAX_VCPUS (16)
set -euo pipefail
cd "$(dirname "$0")"

STACK=${STACK:-splattunnel}
REGION=${AWS_REGION:-us-east-1}
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
BUDGET=${BUDGET:-100}
ORIGIN=${ORIGIN:-*}

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

build_images() {
  local bucket project tmp
  bucket=$(out BucketName); project=$(out ImageBuildProject)
  tmp=$(mktemp -d)
  (cd containers && zip -qr "$tmp/containers.zip" foam splat)
  aws s3 cp --only-show-errors "$tmp/containers.zip" "s3://$bucket/code/containers.zip"
  local id
  id=$(aws codebuild start-build --project-name "$project" --query build.id --output text)
  echo "Building container images (about 20-30 minutes, roughly \$0.60): $id"
  echo "Watch: https://$REGION.console.aws.amazon.com/codesuite/codebuild/projects/$project/history"
}

if [[ "${1:-}" == "--rebuild-images" ]]; then build_images; exit 0; fi

# CI mode (GitHub Actions): update an existing stack, keeping every parameter as it was.
if [[ "${1:-}" == "--update" ]]; then
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  ART="splattunnel-artifacts-$ACCOUNT-$REGION"
  aws cloudformation package --template-file template.yaml --s3-bucket "$ART" --output-template-file .packaged.yaml >/dev/null
  aws cloudformation deploy --stack-name "$STACK" --template-file .packaged.yaml \
    --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset
  if [[ "${REBUILD_IMAGES:-0}" == "1" ]]; then build_images; fi
  exit 0
fi

EMAIL=${1:-}
if [[ -z "$EMAIL" ]]; then echo "usage: ./deploy.sh your@email.com   (budget alerts go there)"; exit 1; fi

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "Account $ACCOUNT, region $REGION, stack $STACK, budget \$$BUDGET/month"

VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
if [[ "$VPC" == "None" || -z "$VPC" ]]; then
  echo "No default VPC in $REGION. Create one with: aws ec2 create-default-vpc"; exit 1
fi
SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text | tr '\t' ',')

# keep the same access key across redeploys
KEY_FILE=".api-key.$STACK"
if [[ -f "$KEY_FILE" ]]; then API_KEY=$(cat "$KEY_FILE"); else API_KEY=$(openssl rand -hex 24); echo "$API_KEY" > "$KEY_FILE"; chmod 600 "$KEY_FILE"; fi

ART="splattunnel-artifacts-$ACCOUNT-$REGION"
aws s3api head-bucket --bucket "$ART" 2>/dev/null || {
  if [[ "$REGION" == "us-east-1" ]]; then aws s3api create-bucket --bucket "$ART" >/dev/null
  else aws s3api create-bucket --bucket "$ART" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null; fi
  aws s3api put-public-access-block --bucket "$ART" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
}

aws cloudformation package --template-file template.yaml --s3-bucket "$ART" --output-template-file .packaged.yaml >/dev/null
aws cloudformation deploy --stack-name "$STACK" --template-file .packaged.yaml \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset \
  --parameter-overrides ApiKey="$API_KEY" AlertEmail="$EMAIL" MonthlyBudget="$BUDGET" VpcId="$VPC" SubnetIds="$SUBNETS" \
    AllowedOrigin="$ORIGIN" GpuMaxVcpus="${GPU_MAX_VCPUS:-8}" CpuMaxVcpus="${CPU_MAX_VCPUS:-16}"

build_images

# New accounts often have a GPU quota of 0. Check it now rather than when a job sits in RUNNABLE forever.
SPOT_G=$(aws service-quotas get-service-quota --service-code ec2 --quota-code L-3819A6DF --query Quota.Value --output text 2>/dev/null || echo "?")
echo
echo "Done."
echo "  API address: $(out ApiUrl)"
echo "  Access key:  $API_KEY   (also saved in aws/$KEY_FILE; don't commit it)"
echo "  Confirm the budget-alert email AWS just sent to $EMAIL."
if [[ "$SPOT_G" == "?" || "${SPOT_G%.*}" -lt 4 ]]; then
  echo
  echo "  Your spot G-instance quota is ${SPOT_G} vCPUs, so splat training can't start yet."
  echo "  Request at least 8 at: https://$REGION.console.aws.amazon.com/servicequotas/home/services/ec2/quotas/L-3819A6DF"
fi

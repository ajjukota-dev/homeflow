#!/usr/bin/env bash
# Shared config for infra/scripts/*.sh — 03-platform-deploy.md.
set -euo pipefail

# On Windows/Git Bash, MSYS rewrites args that look like absolute Unix paths
# (anything starting with "/") into Windows paths before the AWS CLI ever
# sees them — silently corrupting ARNs, S3 keys, and CloudWatch log group
# names like "/aws/apprunner/...". Harmless no-op on Linux/macOS CI runners.
export MSYS_NO_PATHCONV=1

export AWS_PROFILE=pranava
export AWS_REGION=ap-south-1
export ACCOUNT_ID=975050032697

export ECR_REPO=homeflow-api
export ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO"
export S3_BUCKET="homeflow-files-$ACCOUNT_ID"
export RDS_ID=homeflow-db
export APPRUNNER_SERVICE=homeflow-api
export ECR_ACCESS_ROLE="arn:aws:iam::$ACCOUNT_ID:role/homeflow-apprunner-ecr-access-role"
export INSTANCE_ROLE="arn:aws:iam::$ACCOUNT_ID:role/homeflow-apprunner-instance-role"

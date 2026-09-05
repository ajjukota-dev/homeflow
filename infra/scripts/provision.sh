#!/usr/bin/env bash
# One-time (idempotent) setup of every long-lived AWS resource this service
# needs: ECR repo, S3 bucket, RDS Postgres, IAM roles, Secrets Manager
# entries, the App Runner service itself, and the budget alert.
# `deploy.sh` is what runs on every push; this is run once per account.
#
# Every resource is named homeflow-* and tagged Project=homeflow so it's
# cleanly separable from the unrelated pranava-portal project already in
# this account (975050032697) — see the PR description.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./env.sh

echo "==> ECR repository"
aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPO" \
       --image-scanning-configuration scanOnPush=true \
       --tags Key=Project,Value=homeflow

echo "==> S3 bucket (private, SSE-S3)"
aws s3api head-bucket --bucket "$S3_BUCKET" >/dev/null 2>&1 || {
  aws s3api create-bucket --bucket "$S3_BUCKET" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION"
  aws s3api put-bucket-tagging --bucket "$S3_BUCKET" --tagging 'TagSet=[{Key=Project,Value=homeflow}]'
  aws s3api put-public-access-block --bucket "$S3_BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$S3_BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
}

echo "==> RDS security group + instance"
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text)
SG_ID=$(aws ec2 describe-security-groups --filters Name=group-name,Values=homeflow-db-sg --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "None")
if [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name homeflow-db-sg --description "homeflow RDS access" --vpc-id "$VPC_ID" \
    --tag-specifications 'ResourceType=security-group,Tags=[{Key=Project,Value=homeflow},{Key=Name,Value=homeflow-db-sg}]' \
    --query "GroupId" --output text)
  # App Runner without a VPC connector has no stable egress IP range, so
  # this stays open on 5432 — acceptable while this account holds no real
  # customer PII (TODO §8); tighten before go-live.
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 5432 --cidr 0.0.0.0/0
fi
aws rds describe-db-instances --db-instance-identifier "$RDS_ID" >/dev/null 2>&1 || {
  echo "RDS master password: pass one via RDS_MASTER_PASSWORD env, or set it manually — refusing to invent one silently a second time."
  : "${RDS_MASTER_PASSWORD:?set RDS_MASTER_PASSWORD to create the RDS instance}"
  aws rds create-db-instance \
    --db-instance-identifier "$RDS_ID" --db-instance-class db.t4g.micro \
    --engine postgres --engine-version 16 \
    --master-username homeflow_admin --master-user-password "$RDS_MASTER_PASSWORD" \
    --allocated-storage 20 --storage-type gp3 --db-name homeflow \
    --vpc-security-group-ids "$SG_ID" --backup-retention-period 7 \
    --publicly-accessible --deletion-protection --no-multi-az \
    --tags Key=Project,Value=homeflow
}

echo "==> IAM roles for App Runner"
aws iam get-role --role-name homeflow-apprunner-ecr-access-role >/dev/null 2>&1 || {
  aws iam create-role --role-name homeflow-apprunner-ecr-access-role \
    --assume-role-policy-document file://policies/apprunner-build-trust.json --tags Key=Project,Value=homeflow
  aws iam attach-role-policy --role-name homeflow-apprunner-ecr-access-role \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
}
aws iam get-role --role-name homeflow-apprunner-instance-role >/dev/null 2>&1 || {
  aws iam create-role --role-name homeflow-apprunner-instance-role \
    --assume-role-policy-document file://policies/apprunner-instance-trust.json --tags Key=Project,Value=homeflow
  aws iam put-role-policy --role-name homeflow-apprunner-instance-role \
    --policy-name homeflow-apprunner-instance-policy --policy-document file://policies/apprunner-instance-policy.json
}

echo "==> Secrets Manager"
aws secretsmanager describe-secret --secret-id homeflow-session-secret >/dev/null 2>&1 \
  || aws secretsmanager create-secret --name homeflow-session-secret \
       --secret-string "$(openssl rand -hex 32)" --tags Key=Project,Value=homeflow >/dev/null
aws secretsmanager describe-secret --secret-id homeflow-smtp-pass >/dev/null 2>&1 || {
  : "${SMTP_PASS:?set SMTP_PASS to create homeflow-smtp-pass}"
  aws secretsmanager create-secret --name homeflow-smtp-pass --secret-string "$SMTP_PASS" --tags Key=Project,Value=homeflow >/dev/null
}
aws secretsmanager describe-secret --secret-id homeflow-openai-api-key >/dev/null 2>&1 || {
  : "${OPENAI_API_KEY:?set OPENAI_API_KEY to create homeflow-openai-api-key}"
  aws secretsmanager create-secret --name homeflow-openai-api-key --secret-string "$OPENAI_API_KEY" --tags Key=Project,Value=homeflow >/dev/null
}
aws secretsmanager describe-secret --secret-id homeflow-database-url >/dev/null 2>&1 || {
  RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query "DBInstances[0].Endpoint.Address" --output text)
  : "${RDS_MASTER_PASSWORD:?set RDS_MASTER_PASSWORD to build homeflow-database-url}"
  aws secretsmanager create-secret --name homeflow-database-url \
    --secret-string "postgres://homeflow_admin:${RDS_MASTER_PASSWORD}@${RDS_ENDPOINT}:5432/homeflow" \
    --tags Key=Project,Value=homeflow >/dev/null
}

echo "==> App Runner service"
if ! aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='$APPRUNNER_SERVICE']" --output text | grep -q .; then
  DATABASE_URL_ARN=$(aws secretsmanager describe-secret --secret-id homeflow-database-url --query ARN --output text)
  SESSION_SECRET_ARN=$(aws secretsmanager describe-secret --secret-id homeflow-session-secret --query ARN --output text)
  SMTP_PASS_ARN=$(aws secretsmanager describe-secret --secret-id homeflow-smtp-pass --query ARN --output text)
  OPENAI_KEY_ARN=$(aws secretsmanager describe-secret --secret-id homeflow-openai-api-key --query ARN --output text)
  ./render-apprunner-service.sh "$DATABASE_URL_ARN" "$SESSION_SECRET_ARN" "$SMTP_PASS_ARN" "$OPENAI_KEY_ARN" > /tmp/homeflow-apprunner-service.json
  aws apprunner create-service --cli-input-json file:///tmp/homeflow-apprunner-service.json
fi

echo "==> CloudWatch log retention (30 days)"
SERVICE_ID=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='$APPRUNNER_SERVICE'].ServiceId" --output text)
for suffix in application service; do
  aws logs put-retention-policy --retention-in-days 30 \
    --log-group-name "/aws/apprunner/$APPRUNNER_SERVICE/$SERVICE_ID/$suffix" 2>/dev/null || true
done

echo "==> Budget alert (~₹5,000/month ≈ \$60 — Budgets is a global API, region pinned to us-east-1)"
if ! aws budgets describe-budget --region us-east-1 --account-id "$ACCOUNT_ID" --budget-name homeflow-monthly-budget >/dev/null 2>&1; then
  aws budgets create-budget --region us-east-1 --account-id "$ACCOUNT_ID" --cli-input-json file://budget.json
  for threshold in 80 100; do
    aws budgets create-notification --region us-east-1 --account-id "$ACCOUNT_ID" \
      --budget-name homeflow-monthly-budget \
      --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=$threshold,ThresholdType=PERCENTAGE \
      --subscribers SubscriptionType=EMAIL,Address=pedapatiamarsh@gmail.com
  done
fi

echo "Provisioning complete."

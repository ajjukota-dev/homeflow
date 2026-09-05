#!/usr/bin/env bash
# `npm run deploy` (03-platform-deploy.md rule 5: "produces the same
# service from a clean checkout of main"). Assumes provision.sh has
# already created the long-lived resources (ECR repo, RDS, IAM roles,
# secrets, the App Runner service, the budget).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./env.sh
REPO_ROOT="$(cd ../.. && pwd)"

echo "==> docker build"
docker build -t "$ECR_REPO:local" "$REPO_ROOT"

echo "==> push to ECR"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
docker tag "$ECR_REPO:local" "$ECR_URI:latest"
docker push "$ECR_URI:latest"

echo "==> deploy to App Runner (redeploys :latest — AutoDeploymentsEnabled is false so this is explicit)"
SERVICE_ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='$APPRUNNER_SERVICE'].ServiceArn" --output text)
aws apprunner start-deployment --service-arn "$SERVICE_ARN" >/dev/null
echo "    waiting for the service to report RUNNING..."
until [ "$(aws apprunner describe-service --service-arn "$SERVICE_ARN" --query "Service.Status" --output text)" = "RUNNING" ]; do
  sleep 10
done

SERVICE_URL="https://$(aws apprunner describe-service --service-arn "$SERVICE_ARN" --query "Service.ServiceUrl" --output text)"
echo "    live at $SERVICE_URL"

echo "==> run migrations against RDS"
DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id homeflow-database-url --query SecretString --output text)
DATABASE_URL="$DATABASE_URL" npm --prefix "$REPO_ROOT/services/api" run migrate

echo "==> smoke test GET /health"
curl -sf "$SERVICE_URL/health" | tee /dev/stderr | grep -q '"ok":true'

echo "Deployed: $SERVICE_URL"

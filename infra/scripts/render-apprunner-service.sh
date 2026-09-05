#!/usr/bin/env bash
# Prints the apprunner create-service JSON with the account's actual
# Secrets Manager ARNs filled in (they carry a random suffix AWS assigns
# at creation, so they can't be hardcoded). Usage:
#   ./render-apprunner-service.sh <db_url_arn> <session_secret_arn> <smtp_pass_arn> <openai_key_arn>
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./env.sh

DATABASE_URL_ARN="$1"
SESSION_SECRET_ARN="$2"
SMTP_PASS_ARN="$3"
OPENAI_KEY_ARN="$4"

cat <<JSON
{
  "ServiceName": "$APPRUNNER_SERVICE",
  "SourceConfiguration": {
    "AuthenticationConfiguration": { "AccessRoleArn": "$ECR_ACCESS_ROLE" },
    "AutoDeploymentsEnabled": false,
    "ImageRepository": {
      "ImageIdentifier": "$ECR_URI:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "PORT": "8080",
          "SEED_DEMO": "1"
        },
        "RuntimeEnvironmentSecrets": {
          "DATABASE_URL": "$DATABASE_URL_ARN",
          "SESSION_SECRET": "$SESSION_SECRET_ARN",
          "SMTP_PASS": "$SMTP_PASS_ARN",
          "OPENAI_API_KEY": "$OPENAI_KEY_ARN"
        }
      }
    }
  },
  "InstanceConfiguration": {
    "Cpu": "1024",
    "Memory": "2048",
    "InstanceRoleArn": "$INSTANCE_ROLE"
  },
  "HealthCheckConfiguration": {
    "Protocol": "HTTP",
    "Path": "/health",
    "Interval": 10,
    "Timeout": 5,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  },
  "Tags": [{ "Key": "Project", "Value": "homeflow" }]
}
JSON

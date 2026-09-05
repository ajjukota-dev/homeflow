# HomeFlow — AWS infra (plain scripts, not CDK)

The old CDK stacks (Cognito, EventBridge, Aurora, Lambda, HTTP API — see
git history) were never deployed and are deleted. This account's deploy
is one container on **App Runner** + **RDS Postgres** + **S3**, built with
idempotent AWS CLI scripts under `infra/scripts/` — chosen over CDK
because App Runner's CDK L2 is still alpha, and getting a live URL fast
mattered more than IaC polish for this account (see the r0/03-platform
PR for the full reasoning).

Account `975050032697`, region `ap-south-1`, CLI profile `pranava`.
Every resource is named `homeflow-*` and tagged `Project=homeflow` —
this account also holds an unrelated `pranava-portal` project; never
touch anything not carrying that tag/prefix.

## One-time setup

```bash
export RDS_MASTER_PASSWORD=...   # only needed the first time (creates the RDS instance + its secret)
export SMTP_PASS=...             # Gmail app password
export OPENAI_API_KEY=...
bash infra/scripts/provision.sh
```

Creates: ECR repo, S3 bucket (private, SSE-S3), RDS Postgres 16
(db.t4g.micro, 20 GB gp3, single-AZ, 7-day backups, deletion protection,
publicly accessible — see the PR for why), two IAM roles (ECR pull +
S3/Secrets read), four Secrets Manager entries, the App Runner service,
30-day CloudWatch log retention, and a ~₹5,000/month budget alert.

Re-running is safe — every step checks whether its resource already
exists first.

## Every deploy

```bash
npm run deploy   # = bash infra/scripts/deploy.sh
```

Builds the image, pushes `:latest` to ECR, redeploys the App Runner
service, runs `services/api`'s migrations against RDS, and smoke-tests
`GET /health`.

## Known deviation (fix before real customer data lands here)

RDS is publicly accessible with a security group open on 5432 to
0.0.0.0/0. App Runner without a VPC connector has no fixed egress IP
range to scope that down to, and a VPC connector needs NAT (~$32/mo,
blows the ₹5k budget) or VPC endpoints. Fine for now — this account
holds no real customer PII (TODO §8) — but tighten this (VPC connector +
NAT/endpoints, or move to Pranava's own account) before go-live.

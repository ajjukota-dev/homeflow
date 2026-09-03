# HomeFlow · AWS Infrastructure (CDK)

Infrastructure-as-code for HomeFlow on AWS. **Written and validated (`cdk synth` passes), not yet deployed** — we build locally (PGlite + Express) and deploy here when a few slices are proven. Same domain code, re-pointed by env (architecture.md §6b).

## Stacks

| Stack | Contains |
|---|---|
| `HomeFlow-Platform` | Cognito (workspace + customer clients), EventBridge bus (`homeflow-events`), encrypted+versioned S3 files bucket |
| `HomeFlow-App` | VPC, **Aurora Serverless v2 (PostgreSQL 16)** system of record, API **Lambda** (Node 22) behind an **HTTP API Gateway** |

The Lambda hosts the *same* domain handlers we run locally under Express (`services/api`); `infra/lambda/index.mjs` is the deployment shell, replaced by the bundled handlers at deploy time.

## Prerequisites (when we deploy)

1. AWS account + credentials configured locally (`aws configure` or SSO). Recommended region **ap-south-1 (Mumbai)**.
2. Verify identity: `aws sts get-caller-identity`.
3. Node 20+.

## Commands

```
npm install
npm run synth      # compile CDK → CloudFormation (no AWS account needed) ✅ verified
npm run bootstrap  # one-time per account/region: cdk bootstrap
npm run diff       # preview changes vs deployed
npm run deploy     # cdk deploy --all  (provisions real infra — costs money)
npm run destroy    # cdk destroy --all (tear down to stop billing)
```

## Cost & safety notes

- **Dev posture:** `removalPolicy: DESTROY` on Aurora + S3 and `autoDeleteObjects` so `destroy` cleans up. **Harden for production** (RETAIN, deletion protection).
- Main cost drivers: Aurora Serverless v2 (min 0.5 ACU), 1 NAT gateway. Run `npm run destroy` when not in use to avoid idle billing.
- No secrets in code: DB credentials are a generated Secrets Manager secret; the Lambda gets read access only.

## Deploy path (future slice)

1. `aws configure` (ap-south-1) → `aws sts get-caller-identity`.
2. `cd infra && npm run bootstrap`.
3. Bundle `services/api` handlers into `infra/lambda` (build step) — replaces the shell.
4. `npm run deploy` → note the `ApiUrl` output.
5. Run schema migrations against Aurora (same SQL as local).
6. Point the frontend `/api` at the deployed `ApiUrl`.

Until then, everything runs locally with no AWS dependency.

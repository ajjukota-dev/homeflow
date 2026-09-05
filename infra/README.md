# HomeFlow · AWS infrastructure (CDK)

TypeScript CDK, region **`ap-south-1` (Mumbai)**, two stacks. `npm run synth` and
`npm test` pass with **no AWS account and no credentials** — that is what CI runs
on every PR.

> **No `cdk deploy` until Pranava approves the account, the region and the budget.**
> Nothing in this directory has ever been deployed. `HANDOFF.md` and TASKS Vivek 9
> both hold this gate. Read the cost table below before asking.

---

## Stacks

| Stack | Holds | Removal |
|---|---|---|
| `HomeFlow-Data` | VPC (2 AZs, **no NAT gateway**), RDS PostgreSQL 16, files bucket, ALB-logs bucket, five Secrets Manager secrets, a Secrets Manager VPC endpoint | every resource `RETAIN`; `terminationProtection` on in prod |
| `HomeFlow-Service` | ECR repository, ECS cluster, Fargate service behind an ALB, ACM certificate, two Route 53 records, task role, CloudWatch log group + five alarms → SNS | replaceable in full; deleting it cannot touch data |

Stack names get a `-staging` suffix when `-c stage=staging`.

### What is deliberately not here

`aws-cdk-lib` makes it easy to spend money. The 4 September shape had Aurora
Serverless v2, a Lambda per domain behind an HTTP API, an EventBridge bus,
Cognito and a NAT gateway — about **$150/month** and no local equivalent for the
storage engine. This shape runs the same container image as `docker compose`,
costs about **$57/month**, and moving to Aurora later is a snapshot restore.

---

## Cost, production (architecture.md §3.1)

| Item | ≈ USD / month |
|---|---|
| RDS `db.t4g.micro`, single-AZ, 20 GB gp3 | 15 |
| Fargate 0.5 vCPU / 1 GB × 1 task | 18 |
| Application Load Balancer | 18 |
| S3, SES, Secrets Manager, Route 53, logs | 6 |
| Secrets Manager VPC endpoint (needed for credential rotation) | 7 |
| **Total** | **≈ 64** |

Multi-AZ RDS and a second task (both on in `stage=prod`) add ≈ $35.
`stage=staging` scales to zero every night, so it costs roughly the ALB and RDS.

---

## Commands

```
npm install
npm run synth                       # → cdk.out (git-ignored). No credentials needed. ✅
npm run synth -- -c stage=staging   # the staging shape
npm test                            # CDK assertions (jest). ✅
npm run diff                        # needs credentials
npm run deploy                      # DO NOT RUN — see the gate at the top
```

Context keys (`-c key=value`, or `cdk.json`):

| Key | Default | Meaning |
|---|---|---|
| `stage` | `prod` | `prod` or `staging` |
| `zoneName` | `pranava.in` | Route 53 hosted zone name |
| `hostedZoneId` | `PLACEHOLDER_HOSTED_ZONE_ID` | the real id, from the console |
| `workspaceDomain` | `homeflow.pranava.in` | internal app hostname |
| `customerDomain` | `my.pranava.in` | customer app hostname |
| `imageTag` | `latest` | ECR tag to run; the release workflow passes the git SHA |
| `alarmEmail` | — | subscribes an address to the alarm topic |

`hostedZoneId` is context rather than `HostedZone.fromLookup` on purpose:
`fromLookup` resolves against a live account, which would break `synth` in CI.

---

## Manual steps

These are the four things a person does once, in order. None of them belongs in
code, and three of them are secrets.

1. **Hosted zone.** `pranava.in` must already be a Route 53 public hosted zone in
   the target account. Put its id in `cdk.json` context or pass `-c hostedZoneId=`.
   The ACM certificate is DNS-validated against it, so the first deploy waits
   until the validation records resolve.

2. **Deploy `HomeFlow-Data` first, by a person, with review:**
   ```
   npx cdk deploy HomeFlow-Data --require-approval broadening -c hostedZoneId=Z...
   ```
   Note `DbEndpoint` from the outputs.

3. **Give `homeflow_app` a password and fill the DSN secrets.**
   Migration `0001_kernel.py` creates the `homeflow_app` role (`LOGIN NOBYPASSRLS`)
   but cannot give it a password — the migration runs on every start and a
   password in a migration would be a password in git. Do it once:

   ```bash
   # a) pick a password, and write both DSNs into Secrets Manager
   APPPW=$(openssl rand -base64 24 | tr -d '/+=')
   HOST=<DbEndpoint from step 2>
   OWNERPW=$(aws secretsmanager get-secret-value --secret-id homeflow/prod/rds-owner \
              --query SecretString --output text | jq -r .password)

   aws secretsmanager put-secret-value --secret-id homeflow/prod/owner-database-url \
     --secret-string "postgresql+asyncpg://homeflow_owner:$OWNERPW@$HOST:5432/homeflow"
   aws secretsmanager put-secret-value --secret-id homeflow/prod/database-url \
     --secret-string "postgresql+asyncpg://homeflow_app:$APPPW@$HOST:5432/homeflow"
   ```

   ```bash
   # b) after step 5, when a task definition exists, set the role's password with
   #    a one-off RunTask on the service's own image, network and secrets.
   #    APPPW travels as an environment override, never on the command line, so
   #    it does not land in CloudTrail's command record or a log line.
   PY='import asyncio,os,asyncpg
   async def main():
       dsn = os.environ["OWNER_DATABASE_URL"].replace("+asyncpg", "")
       conn = await asyncpg.connect(dsn)
       await conn.execute("ALTER ROLE homeflow_app PASSWORD $1", os.environ["APPPW"])
       await conn.close()
       print("homeflow_app password set")
   asyncio.run(main())'

   aws ecs run-task \
     --cluster <HomeFlow-Service cluster> \
     --task-definition <the service task definition> \
     --launch-type FARGATE \
     --network-configuration 'awsvpcConfiguration={subnets=[<public subnet ids>],securityGroups=[<service sg>],assignPublicIp=ENABLED}' \
     --overrides "$(jq -n --arg py "$PY" --arg pw "$APPPW" '{containerOverrides:[{
        name:"web",
        command:["python","-c",$py],
        environment:[{name:"APPPW",value:$pw}]
      }]}')"
   ```
   Check the task's log stream in `/homeflow/api` for `homeflow_app password set`,
   then redeploy the service so tasks pick up the working DSN.

   *Why not a Lambda custom resource:* a Postgres client is not in the Lambda
   Python runtime, so an inline-code custom resource cannot do this, and a bundled
   one would need an asset built at synth time — which breaks `synth` in CI. The
   API image already has `asyncpg` and network reachability, so it does the job.

4. **Fill the three named secrets** (`homeflow/prod/google-oauth`,
   `messaging-provider`, `session-secret`). Shapes:
   ```json
   google-oauth        {"client_id": "...", "client_secret": "..."}
   messaging-provider  {"api_key": "..."}
   session-secret      "<64 random bytes, base64>"        // plain string
   ```

5. **Push an image, then deploy the service.**
   ```
   docker build -t homeflow-api -f services/api/Dockerfile .
   aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.ap-south-1.amazonaws.com
   docker tag homeflow-api <acct>.dkr.ecr.ap-south-1.amazonaws.com/homeflow-api:<sha>
   docker push <acct>.dkr.ecr.ap-south-1.amazonaws.com/homeflow-api:<sha>
   npx cdk deploy HomeFlow-Service -c imageTag=<sha> -c hostedZoneId=Z...
   ```
   The container's entrypoint runs `alembic upgrade head` under an advisory lock,
   seeds config, and starts uvicorn. Two tasks starting together is safe.

**Order matters:** data → secrets → image → service. The service will not start
without the DSN secrets, and the ALB will not come up without the certificate.

---

## Rollback

Redeploy the previous tag: `cdk deploy HomeFlow-Service -c imageTag=<previous sha>`.
The circuit breaker already rolls back a deploy whose tasks never pass `/health`.
Migrations are forward-only, so a rollback must go to a version compatible with
the current schema — every migration PR states which.

## Restore drill (technical/10 §8)

Quarterly, and before go-live:

1. `aws rds restore-db-instance-from-db-snapshot` into a new instance.
2. Point a `stage=staging` service at it (`owner-database-url` / `database-url`).
3. Run `services/api/tests/rls/` and the acceptance tests against it.
4. Record the wall-clock time. Target RTO ≤ 1 hour, RPO ≤ 5 minutes (PITR).

## What the tests hold

`npm test` (`test/stacks.test.ts`, 25 assertions) fails if any of these regress:
no NAT gateway; RDS encrypted, `deletionProtection`, 14-day backups, `rds.force_ssl=1`,
RETAIN; the files bucket blocks public access, is versioned, is encrypted, and
CORS-allows only the two HomeFlow origins; the task role has no `s3:*` and no
wildcard resource; SES is conditioned on `noreply@pranava.in`; Postgres ingress
comes from a security group and never a CIDR; no secret value appears in the task
definition as plain environment; region is `ap-south-1`; staging scales to zero
and prod does not.

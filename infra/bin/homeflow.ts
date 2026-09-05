#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack";
import { ServiceStack } from "../lib/service-stack";

/**
 * Two stacks, one region (technical/10 s4, architecture s3).
 *
 * Everything that varies comes from context, so `npm run synth` works with no
 * AWS account and no credentials - CI runs it on every PR. Nothing here calls
 * `fromLookup`, which would need an account to resolve.
 *
 *   cdk synth -c stage=staging -c imageTag=abc1234
 */
const app = new App();

const stage = app.node.tryGetContext("stage") ?? "prod";
const region = "ap-south-1"; // Mumbai - Indian customer data stays in India.
const account = process.env.CDK_DEFAULT_ACCOUNT; // undefined until someone deploys
const env = { account, region };

const suffix = stage === "prod" ? "" : `-${stage}`;
const zoneName = app.node.tryGetContext("zoneName") ?? "pranava.in";
const hostedZoneId = app.node.tryGetContext("hostedZoneId") ?? "PLACEHOLDER_HOSTED_ZONE_ID";
const workspaceDomain = app.node.tryGetContext("workspaceDomain") ?? (stage === "prod" ? `homeflow.${zoneName}` : `staging.homeflow.${zoneName}`);
const customerDomain = app.node.tryGetContext("customerDomain") ?? (stage === "prod" ? `my.${zoneName}` : `my-staging.${zoneName}`);
const imageTag = app.node.tryGetContext("imageTag") ?? "latest";
const alarmEmail = app.node.tryGetContext("alarmEmail");

const data = new DataStack(app, `HomeFlow-Data${suffix}`, {
  env,
  stage,
  appOrigins: [`https://${workspaceDomain}`, `https://${customerDomain}`],
  description: "HomeFlow stateful resources: VPC, RDS PostgreSQL, files bucket, secrets. RETAIN.",
});

new ServiceStack(app, `HomeFlow-Service${suffix}`, {
  env,
  stage,
  vpc: data.vpc,
  database: data.database,
  filesBucket: data.filesBucket,
  albLogsBucket: data.albLogsBucket,
  appDatabaseUrl: data.appDatabaseUrl,
  ownerDatabaseUrl: data.ownerDatabaseUrl,
  googleOauth: data.googleOauth,
  messagingProvider: data.messagingProvider,
  sessionSecret: data.sessionSecret,
  hostedZoneId,
  zoneName,
  workspaceDomain,
  customerDomain,
  imageTag,
  alarmEmail,
  description: "HomeFlow stateless resources: ECR, ECS Fargate, ALB, ACM, Route 53, alarms.",
});

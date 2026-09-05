#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { PlatformStack } from "../lib/platform-stack";
import { AppStack } from "../lib/app-stack";

// Env resolved from the AWS profile at deploy time (recommend ap-south-1 Mumbai).
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-south-1",
};

const app = new App();

const platform = new PlatformStack(app, "HomeFlow-Platform", { env });
new AppStack(app, "HomeFlow-App", {
  env,
  bus: platform.bus,
  files: platform.files,
});

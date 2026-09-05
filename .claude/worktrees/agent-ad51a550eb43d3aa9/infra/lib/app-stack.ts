import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as s3 from "aws-cdk-lib/aws-s3";
import { HttpApi, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";

interface AppStackProps extends StackProps {
  bus: events.EventBus;
  files: s3.Bucket;
}

/**
 * The core app tier: VPC + Aurora Serverless v2 (system of record) + the API Lambda
 * behind an HTTP API Gateway. Kept in one stack so the Lambda↔DB security-group wiring
 * is intra-stack (no cross-stack cycle). Shared platform (auth/events/files) is separate.
 * architecture.md §2, §6b.
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 1 });

    // System of record — same schema as local PGlite.
    const db = new rds.DatabaseCluster(this, "Aurora", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("16.4", "16"),
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      credentials: rds.Credentials.fromGeneratedSecret("homeflow_admin"),
      defaultDatabaseName: "homeflow",
      storageEncrypted: true,
      backup: { retention: Duration.days(7) },
      removalPolicy: RemovalPolicy.DESTROY, // dev only
    });

    // The API Lambda hosts the same domain handlers we run locally under Express.
    const fn = new lambda.Function(this, "ApiFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda"),
      vpc,
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: {
        DB_SECRET_ARN: db.secret?.secretArn ?? "",
        EVENT_BUS_NAME: props.bus.eventBusName,
        FILES_BUCKET: props.files.bucketName,
      },
    });

    // Least-privilege wiring (intra-stack for DB, one-way to platform).
    db.secret?.grantRead(fn);
    db.connections.allowDefaultPortFrom(fn);
    props.bus.grantPutEventsTo(fn);
    props.files.grantReadWrite(fn);

    const api = new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ["*"],
      },
    });
    api.addRoutes({
      path: "/api/{proxy+}",
      integration: new HttpLambdaIntegration("ApiInt", fn),
    });

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
  }
}

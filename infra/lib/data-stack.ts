import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

/**
 * Stateful resources (technical/10 s4, architecture s3).
 *
 * Everything here is RETAIN: a bad service deploy must never be able to touch
 * data. The service half lives in ServiceStack and can be replaced freely.
 *
 * Deliberately absent from the 4 Sep shape: Aurora Serverless v2 (3-5x the price
 * for scale this product will not need for years, and no local equivalent),
 * a NAT gateway (~$35/month; tasks run in public subnets behind a security
 * group that admits only the ALB), Cognito and an EventBridge bus.
 */
export interface DataStackProps extends StackProps {
  /** "prod" or "staging". Drives instance size, Multi-AZ and termination protection. */
  readonly stage: string;
  /** Origins allowed to PUT to the files bucket with a presigned URL. */
  readonly appOrigins: string[];
}

export class DataStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly database: rds.DatabaseInstance;
  readonly filesBucket: s3.Bucket;
  readonly albLogsBucket: s3.Bucket;
  /** Plaintext DSNs, set by hand once - see infra/README.md "Manual steps". */
  readonly appDatabaseUrl: secretsmanager.Secret;
  readonly ownerDatabaseUrl: secretsmanager.Secret;
  readonly googleOauth: secretsmanager.Secret;
  readonly messagingProvider: secretsmanager.Secret;
  readonly sessionSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    const isProd = props.stage === "prod";
    super(scope, id, { ...props, terminationProtection: isProd });

    // ---- Network -----------------------------------------------------------
    // No NAT gateway. Tasks sit in the public subnets with a public IP for
    // outbound calls to Google / the messaging provider / SES; the service
    // security group accepts inbound from the ALB only (ServiceStack).
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // The credential-rotation Lambda runs in the isolated subnets, which have no
    // route out. Without this endpoint rotation fails silently every 30 days.
    this.vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // ---- Database ----------------------------------------------------------
    const parameterGroup = new rds.ParameterGroup(this, "DbParams", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_4 }),
      description: "HomeFlow: TLS is not optional.",
      parameters: { "rds.force_ssl": "1" },
    });

    this.database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_4 }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        isProd ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO,
      ),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      multiAz: isProd,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      backupRetention: Duration.days(14),
      deletionProtection: true,
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
      parameterGroup,
      databaseName: "homeflow",
      credentials: rds.Credentials.fromGeneratedSecret("homeflow_owner", { secretName: `homeflow/${props.stage}/rds-owner` }),
      removalPolicy: RemovalPolicy.RETAIN,
      caCertificate: rds.CaCertificate.RDS_CA_RDS4096_G1,
    });
    this.database.addRotationSingleUser({ automaticallyAfter: Duration.days(30) });

    // ---- Files -------------------------------------------------------------
    this.filesBucket = new s3.Bucket(this, "Files", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true, // a legal document's history, for free
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { id: "noncurrent-to-ia", noncurrentVersionTransitions: [{ storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(90) }] },
        { id: "abort-incomplete-uploads", abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: props.appOrigins,
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
    });

    this.albLogsBucket = new s3.Bucket(this, "AlbLogs", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ id: "expire-old-logs", expiration: Duration.days(400) }],
    });

    // ---- Secrets -----------------------------------------------------------
    // Values are never in code and never in a task definition as plain env
    // (technical/10 s6). CDK creates the envelope; a person fills it in once.
    const secret = (name: string, description: string) =>
      new secretsmanager.Secret(this, name, {
        secretName: `homeflow/${props.stage}/${name.toLowerCase()}`,
        description,
        removalPolicy: RemovalPolicy.RETAIN,
      });

    this.googleOauth = secret("google-oauth", "Google OIDC client id and secret for staff sign-in (technical/03 s1).");
    this.messagingProvider = secret("messaging-provider", "WhatsApp/SMS provider API key (architecture s3).");
    this.sessionSecret = secret("session-secret", "SESSION_SECRET: peppers OTP hashes (technical/03 s2).");
    this.appDatabaseUrl = secret("database-url", "Full DSN for homeflow_app (RLS applies). See README, Manual steps.");
    this.ownerDatabaseUrl = secret("owner-database-url", "Full DSN for homeflow_owner (Alembic runs as this).");

    // ---- Outputs -----------------------------------------------------------
    new CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
    new CfnOutput(this, "DbEndpoint", { value: this.database.dbInstanceEndpointAddress });
    new CfnOutput(this, "DbOwnerSecretArn", { value: this.database.secret?.secretArn ?? "none" });
    new CfnOutput(this, "AppDatabaseUrlSecretArn", { value: this.appDatabaseUrl.secretArn });
    new CfnOutput(this, "OwnerDatabaseUrlSecretArn", { value: this.ownerDatabaseUrl.secretArn });
    new CfnOutput(this, "GoogleOauthSecretArn", { value: this.googleOauth.secretArn });
    new CfnOutput(this, "MessagingProviderSecretArn", { value: this.messagingProvider.secretArn });
    new CfnOutput(this, "SessionSecretArn", { value: this.sessionSecret.secretArn });
    new CfnOutput(this, "FilesBucketName", { value: this.filesBucket.bucketName });
    new CfnOutput(this, "AlbLogsBucketName", { value: this.albLogsBucket.bucketName });
  }
}

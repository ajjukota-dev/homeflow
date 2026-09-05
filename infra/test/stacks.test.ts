import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DataStack } from "../lib/data-stack";
import { ServiceStack } from "../lib/service-stack";

/**
 * The properties that cost money, lose data or open a door if they regress.
 * These are the ones a reviewer cannot eyeball in a 400-line CloudFormation diff.
 */
function build(stage = "prod") {
  const app = new App({ context: { stage } });
  const env = { account: "123456789012", region: "ap-south-1" };
  const data = new DataStack(app, "Data", {
    env,
    stage,
    appOrigins: ["https://homeflow.pranava.in", "https://my.pranava.in"],
  });
  const service = new ServiceStack(app, "Service", {
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
    hostedZoneId: "Z0123456789ABCDEFGHIJ",
    zoneName: "pranava.in",
    workspaceDomain: "homeflow.pranava.in",
    customerDomain: "my.pranava.in",
    imageTag: "test",
  });
  return { data: Template.fromStack(data), service: Template.fromStack(service), dataStack: data, serviceStack: service };
}

describe("DataStack", () => {
  const { data, dataStack } = build();

  test("region is ap-south-1 — Indian customer data stays in India", () => {
    expect(dataStack.region).toBe("ap-south-1");
  });

  test("there is no NAT gateway — that is ~$35/month of nothing", () => {
    data.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  test("the database is encrypted, protected, and backed up for 14 days", () => {
    data.hasResourceProperties("AWS::RDS::DBInstance", {
      StorageEncrypted: true,
      DeletionProtection: true,
      BackupRetentionPeriod: 14,
      Engine: "postgres",
      EnablePerformanceInsights: true,
      StorageType: "gp3",
      MaxAllocatedStorage: 100,
    });
  });

  test("the database is never deleted by a stack update", () => {
    data.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
  });

  test("TLS to the database is not optional", () => {
    data.hasResourceProperties("AWS::RDS::DBParameterGroup", {
      Parameters: { "rds.force_ssl": "1" },
    });
  });

  test("the owner credential rotates", () => {
    data.resourceCountIs("AWS::SecretsManager::RotationSchedule", 1);
  });

  test("the files bucket blocks public access, is versioned and encrypted", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
      },
    });
  });

  test("presigned PUTs are allowed only from the two HomeFlow hostnames", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: [Match.objectLike({ AllowedOrigins: ["https://homeflow.pranava.in", "https://my.pranava.in"] })],
      },
    });
  });

  test("the three named secrets exist and hold no value in code", () => {
    for (const name of ["google-oauth", "messaging-provider", "session-secret"]) {
      data.hasResourceProperties("AWS::SecretsManager::Secret", {
        Name: `homeflow/prod/${name}`,
        // No literal value and no template: a person sets these once, by hand.
        SecretString: Match.absent(),
        GenerateSecretString: {},
      });
    }
  });

  test("no secret template in the whole stack carries a literal password", () => {
    const secrets = data.findResources("AWS::SecretsManager::Secret");
    expect(Object.keys(secrets).length).toBe(6); // 3 named + 2 DSNs + the RDS owner
    for (const s of Object.values(secrets)) {
      expect(JSON.stringify(s.Properties)).not.toMatch(/"SecretString"\s*:\s*"/);
    }
  });
});

describe("ServiceStack", () => {
  const { service } = build();

  test("tasks are 0.5 vCPU / 1 GB and listen on 8001", () => {
    service.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "512",
      Memory: "1024",
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ PortMappings: Match.arrayWith([Match.objectLike({ ContainerPort: 8001 })]) }),
      ]),
    });
  });

  test("a failing deploy rolls itself back", () => {
    service.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
      }),
    });
  });

  test("tasks get a public IP so no NAT gateway is needed", () => {
    service.hasResourceProperties("AWS::ECS::Service", {
      NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "ENABLED" }) },
    });
  });

  test("the load balancer terminates TLS and redirects 80 to 443", () => {
    service.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", { Port: 443, Protocol: "HTTPS" });
    service.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 80,
      DefaultActions: Match.arrayWith([Match.objectLike({ Type: "redirect", RedirectConfig: Match.objectLike({ StatusCode: "HTTP_301" }) })]),
    });
  });

  test("the ALB checks /health", () => {
    service.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", { HealthCheckPath: "/health" });
  });

  test("the database accepts 5432 from the service security group only — never a CIDR", () => {
    const ingress = service.findResources("AWS::EC2::SecurityGroupIngress");
    const toPostgres = Object.values(ingress).filter((r) => r.Properties?.FromPort === 5432);
    expect(toPostgres).toHaveLength(1);
    expect(toPostgres[0].Properties.SourceSecurityGroupId).toBeDefined();
    expect(toPostgres[0].Properties.CidrIp).toBeUndefined();
  });

  test("the task role has no s3 wildcard and no wildcard resource on S3", () => {
    const policies = service.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap((p) => p.Properties?.PolicyDocument?.Statement ?? []);
    const s3Statements = statements.filter((s: { Action?: string | string[] }) =>
      [s.Action ?? []].flat().some((a: string) => a.startsWith("s3:")),
    );
    expect(s3Statements.length).toBeGreaterThan(0);
    for (const s of s3Statements) {
      for (const action of [s.Action].flat()) {
        expect(action).not.toBe("s3:*");
        expect(action).not.toBe("*");
      }
      expect(JSON.stringify(s.Resource)).not.toContain('"*"');
    }
  });

  test("SES may only send as noreply@pranava.in", () => {
    const policies = service.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap((p) => p.Properties?.PolicyDocument?.Statement ?? []);
    const ses = statements.find((s: { Action?: string | string[] }) =>
      [s.Action ?? []].flat().some((a: string) => a.startsWith("ses:")),
    );
    expect(ses).toBeDefined();
    expect(ses.Condition).toEqual({ StringEquals: { "ses:FromAddress": "noreply@pranava.in" } });
  });

  test("logs go to /homeflow/api and are kept for 90 days", () => {
    service.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/homeflow/api", RetentionInDays: 90 });
  });

  test("a dead job raises an alarm — nothing else would notice", () => {
    service.hasResourceProperties("AWS::Logs::MetricFilter", { FilterPattern: '"job.dead"' });
    service.hasResourceProperties("AWS::CloudWatch::Alarm", { MetricName: "DeadJobs" });
  });

  test("the five operational alarms exist", () => {
    service.resourceCountIs("AWS::CloudWatch::Alarm", 5);
  });

  test("both hostnames resolve to the load balancer", () => {
    service.resourceCountIs("AWS::Route53::RecordSet", 2);
    service.hasResourceProperties("AWS::Route53::RecordSet", { Name: "my.pranava.in." });
    service.hasResourceProperties("AWS::Route53::RecordSet", { Name: "homeflow.pranava.in." });
  });

  test("no secret value appears in the task definition as plain environment", () => {
    const taskDefs = service.findResources("AWS::ECS::TaskDefinition");
    const env = Object.values(taskDefs).flatMap((t) =>
      (t.Properties?.ContainerDefinitions ?? []).flatMap((c: { Environment?: { Name: string }[] }) => c.Environment ?? []),
    );
    for (const e of env) {
      expect(e.Name).not.toMatch(/SECRET|PASSWORD|DATABASE_URL|API_KEY/);
    }
  });

  test("prod runs two tasks and does not scale to zero", () => {
    service.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 2 });
    service.resourceCountIs("AWS::ApplicationAutoScaling::ScalableTarget", 0);
  });
});

describe("staging", () => {
  const { service } = build("staging");

  test("one task, and it scales to zero overnight", () => {
    service.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 1 });
    service.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
      MinCapacity: 0,
      ScheduledActions: Match.arrayWith([
        Match.objectLike({ ScalableTargetAction: { MinCapacity: 0, MaxCapacity: 0 } }),
      ]),
    });
  });
});

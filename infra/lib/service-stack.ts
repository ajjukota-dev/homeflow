import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as applicationautoscaling from "aws-cdk-lib/aws-applicationautoscaling";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

/**
 * The stateless half (technical/10 s4). One image, one service, one ALB.
 * Replaceable in its entirety without touching DataStack.
 */
export interface ServiceStackProps extends StackProps {
  readonly stage: string;
  readonly vpc: ec2.IVpc;
  readonly database: rds.DatabaseInstance;
  readonly filesBucket: s3.IBucket;
  readonly albLogsBucket: s3.IBucket;
  readonly appDatabaseUrl: secretsmanager.ISecret;
  readonly ownerDatabaseUrl: secretsmanager.ISecret;
  readonly googleOauth: secretsmanager.ISecret;
  readonly messagingProvider: secretsmanager.ISecret;
  readonly sessionSecret: secretsmanager.ISecret;
  /** Hosted zone, imported from context - `fromLookup` needs an account. */
  readonly hostedZoneId: string;
  readonly zoneName: string;
  readonly workspaceDomain: string;
  readonly customerDomain: string;
  /** ECR tag to run; the release workflow passes the git SHA. */
  readonly imageTag: string;
  /** Where alarms go. Empty means the topic is created with no subscription. */
  readonly alarmEmail?: string;
}

const CONTAINER_PORT = 8001;
const POSTGRES_PORT = 5432;

export class ServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);
    const isProd = props.stage === "prod";

    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: "homeflow-api",
      imageScanOnPush: true,
      lifecycleRules: [{ description: "Keep the last 20 images", maxImageCount: 20 }],
    });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc: props.vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.workspaceDomain,
      subjectAlternativeNames: [props.customerDomain],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const logGroup = new logs.LogGroup(this, "ApiLogs", {
      logGroupName: `/homeflow/${props.stage === "prod" ? "api" : `api-${props.stage}`}`,
      retention: logs.RetentionDays.THREE_MONTHS,
    });

    // Environment from technical/01 s5. Nothing secret is in here.
    const environment: Record<string, string> = {
      ENV: isProd ? "prod" : "staging",
      LOG_LEVEL: "INFO",
      AWS_REGION: this.region,
      S3_BUCKET: props.filesBucket.bucketName,
      SES_REGION: this.region,
      MESSAGING_PROVIDER: "provider",
      WORKSPACE_HOST: props.workspaceDomain,
      CUSTOMER_HOST: props.customerDomain,
      PUBLIC_BASE_URL: `https://${props.workspaceDomain}`,
      GOOGLE_ALLOWED_HD: "pranava.in",
      TICKER_ENABLED: "true",
      HOMEFLOW_DEMO: "false",
    };

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Api", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: isProd ? 2 : 1,
      // Public subnets with a public IP is what removes the NAT gateway; the
      // security group below is what keeps the task private.
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true,
      certificate,
      redirectHTTP: true, // 80 -> 301 -> 443
      domainName: props.workspaceDomain,
      domainZone: zone,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag),
        containerPort: CONTAINER_PORT,
        environment,
        secrets: {
          // Whole-value secrets: the container reads DATABASE_URL as one string,
          // so nothing has to assemble a DSN at start. See README, Manual steps.
          DATABASE_URL: ecs.Secret.fromSecretsManager(props.appDatabaseUrl),
          OWNER_DATABASE_URL: ecs.Secret.fromSecretsManager(props.ownerDatabaseUrl),
          SESSION_SECRET: ecs.Secret.fromSecretsManager(props.sessionSecret),
          GOOGLE_CLIENT_ID: ecs.Secret.fromSecretsManager(props.googleOauth, "client_id"),
          GOOGLE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(props.googleOauth, "client_secret"),
          MESSAGING_API_KEY: ecs.Secret.fromSecretsManager(props.messagingProvider, "api_key"),
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logGroup }),
      },
    });

    service.targetGroup.configureHealthCheck({
      path: "/health",
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });
    service.loadBalancer.logAccessLogs(props.albLogsBucket, "alb");
    service.loadBalancer.setAttribute("routing.http.drop_invalid_header_fields.enabled", "true");

    // ---- Security groups ---------------------------------------------------
    // The pattern already restricts the service SG to the ALB; RDS is opened to
    // the service SG only, so nothing else in the VPC can reach the database.
    //
    // The database's security group is imported by id rather than reached
    // through `props.database.connections`: the latter would attach the ingress
    // rule to the DataStack construct, and since ServiceStack already depends on
    // DataStack (VPC, buckets, secrets) that makes the two stacks cyclic. This
    // way the rule is a ServiceStack resource pointing at a DataStack export.
    const dbSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "DbSecurityGroup",
      props.database.connections.securityGroups[0].securityGroupId,
      { mutable: true },
    );
    dbSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(service.service.connections.securityGroups[0].securityGroupId),
      ec2.Port.tcp(POSTGRES_PORT),
      "HomeFlow API tasks only",
    );

    // ---- Task role: exactly what the app needs, nothing else ---------------
    const taskRole = service.taskDefinition.taskRole;
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [props.filesBucket.arnForObjects("*")],
      }),
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [props.filesBucket.bucketArn] }),
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
        conditions: { StringEquals: { "ses:FromAddress": "noreply@pranava.in" } },
      }),
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          props.googleOauth.secretArn,
          props.messagingProvider.secretArn,
          props.sessionSecret.secretArn,
          props.appDatabaseUrl.secretArn,
          props.ownerDatabaseUrl.secretArn,
        ],
      }),
    );

    // ---- The second record: my.pranava.in on the same ALB ------------------
    new route53.ARecord(this, "CustomerRecord", {
      zone,
      recordName: props.customerDomain,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(service.loadBalancer)),
    });

    // ---- Alarms ------------------------------------------------------------
    const alarms = new sns.Topic(this, "Alarms", { displayName: `HomeFlow ${props.stage} alarms` });
    if (props.alarmEmail) alarms.addSubscription(new snsSubscriptions.EmailSubscription(props.alarmEmail));
    const action = new cwActions.SnsAction(alarms);

    const alarm = (id: string, metric: cloudwatch.IMetric, threshold: number, evaluationPeriods: number, description: string, comparison = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD) => {
      const a = new cloudwatch.Alarm(this, id, {
        metric,
        threshold,
        evaluationPeriods,
        alarmDescription: description,
        comparisonOperator: comparison,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(action);
      return a;
    };

    alarm(
      "Alb5xxRate",
      new cloudwatch.MathExpression({
        expression: "100 * errors / MAX([requests, 1])",
        usingMetrics: {
          errors: service.loadBalancer.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { statistic: "Sum" }),
          requests: service.loadBalancer.metrics.requestCount({ statistic: "Sum" }),
        },
        period: Duration.minutes(5),
      }),
      2,
      1,
      "More than 2% of requests failed at the load balancer for five minutes.",
    );

    alarm("UnhealthyTargets", service.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }), 0, 3, "A task is failing /health.");

    alarm(
      "RdsFreeStorage",
      props.database.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      2 * 1024 * 1024 * 1024,
      2,
      "Under 2 GB of database storage left.",
      cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    );

    alarm("RdsCpu", props.database.metricCPUUtilization({ period: Duration.minutes(5) }), 80, 3, "Database CPU above 80% for fifteen minutes.");

    // A dead job is silent by nature; the log line is the only signal.
    const deadJobs = new logs.MetricFilter(this, "DeadJobFilter", {
      logGroup,
      metricNamespace: "HomeFlow",
      metricName: "DeadJobs",
      filterPattern: logs.FilterPattern.literal('"job.dead"'),
      metricValue: "1",
    });
    alarm("DeadJobs", deadJobs.metric({ statistic: "Sum", period: Duration.minutes(5) }), 0, 1, "A background job exhausted its retries.");

    // ---- Staging only: scale to zero overnight -----------------------------
    if (!isProd) {
      const scalable = service.service.autoScaleTaskCount({ minCapacity: 0, maxCapacity: 2 });
      scalable.scaleOnSchedule("StagingDown", {
        schedule: applicationautoscaling.Schedule.cron({ hour: "16", minute: "0" }), // 21:30 IST
        minCapacity: 0,
        maxCapacity: 0,
      });
      scalable.scaleOnSchedule("StagingUp", {
        schedule: applicationautoscaling.Schedule.cron({ hour: "3", minute: "0", weekDay: "MON-FRI" }), // 08:30 IST
        minCapacity: 1,
        maxCapacity: 2,
      });
    }

    new CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });
    new CfnOutput(this, "WorkspaceUrl", { value: `https://${props.workspaceDomain}` });
    new CfnOutput(this, "CustomerUrl", { value: `https://${props.customerDomain}` });
    new CfnOutput(this, "AlarmTopicArn", { value: alarms.topicArn });
  }
}

import { Stack, StackProps, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as events from "aws-cdk-lib/aws-events";
import * as s3 from "aws-cdk-lib/aws-s3";

/**
 * Shared platform: auth (Cognito), the event bus (EventBridge — the handshake
 * backbone, event-log.md), and the encrypted file store (S3 — docs/photos/evidence).
 */
export class PlatformStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly bus: events.EventBus;
  readonly files: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Auth — carries role + project claims that drive RLS (architecture.md §7).
    this.userPool = new cognito.UserPool(this, "Users", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      removalPolicy: RemovalPolicy.DESTROY, // dev only
    });
    this.userPool.addClient("WorkspaceClient", {
      authFlows: { userPassword: true, userSrp: true },
    });
    this.userPool.addClient("CustomerClient", {
      authFlows: { userPassword: true, userSrp: true },
    });

    // Event bus — every handshake (H1–H12) and audit event fans out here.
    this.bus = new events.EventBus(this, "Bus", { eventBusName: "homeflow-events" });

    // Files — documents, drawings, photos, evidence. Private + encrypted, signed URLs only.
    this.files = new s3.Bucket(this, "Files", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY, // dev only
      autoDeleteObjects: true, // dev only
    });
  }
}

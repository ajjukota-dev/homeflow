import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 03-platform-deploy.md owns the shared `mailer` port; it isn't in this
// worktree yet. This is a minimal stand-in with the same shape (`send`) so
// invite/reset are real and testable now — swap the import in auth/invite.ts
// and auth/reset.ts for the platform port once it lands, no call-site changes.
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

const OUTBOX_DIR = fileURLToPath(new URL("../../.data/mail", import.meta.url));

export class FileMailer implements Mailer {
  async send(msg: MailMessage): Promise<void> {
    await mkdir(OUTBOX_DIR, { recursive: true });
    const file = path.join(OUTBOX_DIR, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({ ...msg, sent_at: new Date().toISOString() }, null, 2), "utf-8");
  }
}

export const mailer: Mailer = new FileMailer();

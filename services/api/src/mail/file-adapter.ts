import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MailerPort, SendMailInput } from "./types";

// Test/dev adapter: writes a .eml file instead of sending — inspect it,
// don't need real SMTP creds to run the suite (03-platform-deploy.md).
function mailDir(): string {
  return process.env.MAIL_DIR ?? "./.data/mail";
}

export function renderEml({ to, subject, html, text }: SendMailInput): string {
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: text/html; charset=utf-8`,
    "",
    html,
    "",
    "--- plain text fallback ---",
    text,
  ].join("\n");
}

export function createFileMailerAdapter(): MailerPort {
  return {
    async send(input) {
      const dir = mailDir();
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${Date.now()}-${randomUUID()}.eml`);
      writeFileSync(path, renderEml(input), "utf8");
    },
  };
}

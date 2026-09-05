import { createFileMailerAdapter } from "./file-adapter";
import { createSmtpMailerAdapter } from "./smtp-adapter";
import type { MailerPort } from "./types";

export type { MailerPort, SendMailInput } from "./types";

// SMTP_HOST set → smtp (Gmail today, Pranava's mailbox later); otherwise
// file (writes .eml — tests and any laptop without SMTP creds).
export function makeMailerPort(): MailerPort {
  const host = process.env.SMTP_HOST;
  if (!host) return createFileMailerAdapter();
  return createSmtpMailerAdapter({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? host,
  });
}

export const mailer: MailerPort = makeMailerPort();

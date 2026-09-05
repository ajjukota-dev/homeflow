import nodemailer from "nodemailer";
import type { MailerPort, SendMailInput } from "./types";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

// Prod/dev adapter: Gmail SMTP (SMTP_* env). §3 stack decision — switches
// to Pranava's own mailbox/domain at handover without touching callers.
export function createSmtpMailerAdapter(config: SmtpConfig): MailerPort {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  return {
    async send({ to, subject, html, text }: SendMailInput) {
      await transporter.sendMail({ from: config.from, to, subject, html, text });
    },
  };
}

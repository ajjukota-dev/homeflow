// mailer port (03-platform-deploy.md): send({to, subject, html, text}),
// two adapters — smtp (Gmail, prod/dev) and file (writes .eml, tests/CI).

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailerPort {
  send(input: SendMailInput): Promise<void>;
}

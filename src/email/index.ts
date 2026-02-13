import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
}

export async function sendEmail(
  options: EmailOptions,
  smtp?: SmtpConfig,
): Promise<SendResult> {
  if (!smtp) {
    console.warn('[email] SMTP not configured — skipping email send');
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  const info = await transport.sendMail({
    from: smtp.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  return { sent: true, messageId: info.messageId };
}

export function getSmtpConfig(): SmtpConfig | undefined {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !pass || !from) {
    return undefined;
  }

  return { host, port: Number(port), user, pass, from };
}

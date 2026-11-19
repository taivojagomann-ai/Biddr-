import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sending email over SMTP (any provider: Resend, Brevo, Postmark, …). Off until
 * SMTP_HOST and EMAIL_FROM are set in Vercel; then the site sends without code changes.
 *   SMTP_HOST, SMTP_PORT (default 465), SMTP_USER, SMTP_PASS, SMTP_SECURE ("false" for
 *   STARTTLS on 587), EMAIL_FROM (e.g. "Biddr <noreply@biddr.org>").
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
}

let transport: Transporter | null = null;
function transporter(): Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  return transport;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  await transporter().sendMail({ from: process.env.EMAIL_FROM, ...mail });
}

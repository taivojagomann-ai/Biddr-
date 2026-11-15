import { MAIL_URL } from "./env";

interface MailpitSummary {
  ID: string;
  Created: string;
}

/** Waits for the newest email to `to` (from the local mail catcher, Mailpit) and returns its text. */
export async function latestEmail(to: string, after = new Date(0), timeoutMs = 20_000): Promise<{ text: string; html: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=5`);
    if (res.ok) {
      const body = (await res.json()) as { messages?: MailpitSummary[] };
      const msg = (body.messages ?? []).find((m) => new Date(m.Created) >= after);
      if (msg) {
        const full = (await (await fetch(`${MAIL_URL}/api/v1/message/${msg.ID}`)).json()) as { Text: string; HTML: string };
        return { text: full.Text ?? "", html: full.HTML ?? "" };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}

/** The 6-digit sign-in code from an email. */
export function codeFrom(text: string): string {
  const m = /\b(\d{6})\b/.exec(text);
  if (!m?.[1]) throw new Error(`No 6-digit code in: ${text.slice(0, 200)}`);
  return m[1];
}

/** The first sign-in link (the Supabase /auth/v1/verify link) from an email. */
export function linkFrom(text: string, html: string): string {
  const m = /(http[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+)/.exec(html) ?? /(http[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>\]]+)/.exec(text);
  if (!m?.[1]) throw new Error("No sign-in link in the email");
  return m[1].replace(/&amp;/g, "&");
}

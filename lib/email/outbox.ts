import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigured, sendEmail } from "./send";
import { buildEmail, EMAIL_TYPES, type EmailNotification } from "./templates";

/** Give up on an email after this many tries. */
const MAX_ATTEMPTS = 5;
/** Only recent notifications are emailed (so switching email on doesn't send old news). */
const MAX_AGE_HOURS = 24;

type Row = EmailNotification & { email_attempts: number };

/**
 * Sends the emails for recent notifications of the emailed types (lib/email/templates.ts),
 * at most once each. Does nothing until SMTP is configured. Called right after such a
 * notification is created (0028 trigger) and every 5 minutes for retries.
 */
export async function processEmailOutbox(admin: SupabaseClient, limit = 50) {
  if (!emailConfigured()) return { configured: false, sent: 0, failed: 0, skipped: 0 };
  const since = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();
  const { data } = await admin
    .from("notifications")
    .select("id, user_id, type, auction_id, data, created_at, email_attempts")
    .is("emailed_at", null)
    .lt("email_attempts", MAX_ATTEMPTS)
    .gt("created_at", since)
    .in("type", EMAIL_TYPES)
    // Newest first: fresh, time-sensitive emails ("please pay by …") go out first; older
    // ones are retried on the next runs.
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const n of data ?? []) {
    // Claim it, so two runs never send the same email.
    const { data: claimed } = await admin
      .from("notifications")
      .update({ email_attempts: n.email_attempts + 1 })
      .eq("id", n.id)
      .is("emailed_at", null)
      .eq("email_attempts", n.email_attempts)
      .select("id");
    if (!claimed?.length) continue;
    try {
      const [{ data: auth }, { data: profile }] = await Promise.all([
        admin.auth.admin.getUserById(n.user_id),
        admin.from("profiles").select("country").eq("id", n.user_id).maybeSingle<{ country: string | null }>(),
      ]);
      const to = auth?.user?.email;
      const email = to ? await buildEmail(admin, { ...n, data: n.data ?? {} }, profile?.country ?? null) : null;
      if (!to || !email) {
        // Not emailed (e.g. a car that ended without a sale) or no address: never try again.
        await admin.from("notifications").update({ email_attempts: MAX_ATTEMPTS, email_error: to ? "not emailed" : "no email address" }).eq("id", n.id);
        skipped += 1;
        continue;
      }
      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, attachments: email.attachments });
      await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_error: null }).eq("id", n.id);
      sent += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("email: sending failed", n.id, message);
      await admin.from("notifications").update({ email_error: message.slice(0, 500) }).eq("id", n.id);
      failed += 1;
    }
  }
  return { configured: true, sent, failed, skipped };
}

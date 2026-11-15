import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { authenticator } from "otplib";
import { ANON_KEY, APP_URL, PASSWORD, SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Service role: bypasses RLS. Only for setting up and checking test data. */
export function adminDb(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, opts);
}

/** A visitor who isn't signed in. */
export function anonDb(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, opts);
}

/**
 * Two-step verification with the user's TOTP authenticator, as an admin does
 * after signing in. Raises the session to assurance level aal2.
 */
async function passTwoFactor(client: SupabaseClient, email: string, totpSecret: string): Promise<void> {
  const { data } = await client.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  if (!factor) throw new Error(`${email} has no verified authenticator`);
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: authenticator.generate(totpSecret) });
  if (error) throw new Error(`Two-step verification failed for ${email}: ${error.message}`);
}

/**
 * A signed-in user's client, exactly as the browser would use it (RLS applies).
 * With `totpSecret`, the session has also passed two-step verification (aal2).
 */
export async function userDb(email: string, { password = PASSWORD, totpSecret }: { password?: string; totpSecret?: string } = {}): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, opts);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  if (totpSecret) await passTwoFactor(client, email, totpSecret);
  return client;
}

export interface BrowserCookie {
  name: string;
  value: string;
  url: string;
  httpOnly: boolean;
  sameSite: "Lax";
}

/**
 * The cookies a real sign-in leaves in the browser, produced by the same
 * @supabase/ssr code the app uses (including chunking of large sessions).
 */
export async function sessionCookies(email: string, { password = PASSWORD, totpSecret }: { password?: string; totpSecret?: string } = {}): Promise<BrowserCookie[]> {
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          if (c.value) jar.set(c.name, c.value);
          else jar.delete(c.name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  if (totpSecret) await passTwoFactor(client as unknown as SupabaseClient, email, totpSecret);
  return [...jar].map(([name, value]) => ({ name, value, url: APP_URL, httpOnly: false, sameSite: "Lax" }));
}

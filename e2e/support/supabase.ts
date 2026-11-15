import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
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

/** A signed-in user's client, exactly as the browser would use it (RLS applies). */
export async function userDb(email: string, password = PASSWORD): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, opts);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
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
export async function sessionCookies(email: string, password = PASSWORD): Promise<BrowserCookie[]> {
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
  return [...jar].map(([name, value]) => ({ name, value, url: APP_URL, httpOnly: false, sameSite: "Lax" }));
}

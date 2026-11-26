import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AssuranceLevel = "aal1" | "aal2";

/**
 * The signed-in user and their assurance level (aal1, or aal2 after two-step
 * verification), both from a token the Supabase Auth server has just verified.
 *
 * Never reads the user object from getSession() (it comes straight from the cookie,
 * and supabase-js warns about it on the server). Only the raw access token is taken
 * from the stored session; getUser(token) has the Auth server verify that exact token,
 * and only then is its "aal" claim read. supabase-js here has no getClaims(), so this is the
 * verified-claims equivalent. Anything that can't be verified counts as signed out.
 */
export async function getVerifiedUser(supabase: SupabaseClient): Promise<{ user: User | null; aal: AssuranceLevel | null }> {
  // The stored session (refreshed first if it had expired). Only its access token is used.
  const { data: stored } = await supabase.auth.getSession();
  const token = stored.session?.access_token;
  if (!token) return { user: null, aal: null };
  const { data: verified, error } = await supabase.auth.getUser(token);
  if (error || !verified.user) return { user: null, aal: null };
  return { user: verified.user, aal: aalClaim(token) };
}

/** The "aal" claim of a JWT (call only for a token the Auth server has verified). Works in the Edge runtime too. */
function aalClaim(token: string): AssuranceLevel | null {
  try {
    const part = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "="))) as { aal?: unknown };
    return payload.aal === "aal2" ? "aal2" : payload.aal === "aal1" ? "aal1" : null;
  } catch {
    return null;
  }
}

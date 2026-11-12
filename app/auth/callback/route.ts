import { NextResponse, type NextRequest } from "next/server";
import { loginPath } from "@/lib/login";
import { isProfileComplete } from "@/lib/profile";
import { safeNext } from "@/lib/redirect";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Landing point for Google OAuth, magic links and the 6-digit code flow.
 * Exchanges the PKCE code (if any), then sends new users to profile setup.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  const providerError = params.get("error");
  if (providerError) {
    // Expired or reused magic links come back as error_code=otp_expired.
    return to(loginPath(next, params.get("error_code") === "otp_expired" ? "link" : "provider"));
  }

  const supabase = getServerSupabase();

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return to(loginPath(next, "link"));
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return to(loginPath(next, code ? "link" : undefined));

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, country")
    .eq("id", user.id)
    .maybeSingle<{ username: string | null; country: string | null }>();

  if (!isProfileComplete(profile)) {
    return to(`/account/setup?next=${encodeURIComponent(next)}`);
  }
  return to(next);
}

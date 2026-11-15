import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/admin", "/sell", "/account", "/two-factor"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!user && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(url);
    // Keep any refreshed session cookies set above.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  // Admin pages need two-step verification. An admin whose session hasn't passed
  // it goes to /two-factor and comes back to the same page. Non-admins fall
  // through to the admin layout, which answers 404.
  if (user && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel().then((r) => r.data, () => null);
    if (aal?.currentLevel !== "aal2") {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
      if (profile?.role === "admin") {
        const url = request.nextUrl.clone();
        url.pathname = "/two-factor";
        url.search = "";
        url.searchParams.set("next", `${pathname}${search}`);
        const redirect = NextResponse.redirect(url);
        response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
        return redirect;
      }
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:png|jpg|jpeg|webp|svg)$).*)"],
};

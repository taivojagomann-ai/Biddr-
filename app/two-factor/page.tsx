import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin";
import { safeNext } from "@/lib/redirect";
import { getServerSupabase } from "@/lib/supabase/server";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-step verification", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type SearchParams = { next?: string | string[] };

/**
 * The admin's second step after signing in: a 6-digit code from an
 * authenticator app. Admins without one set it up here first.
 */
export default async function TwoFactorPage({ searchParams }: { searchParams: SearchParams }) {
  const next = safeNext(searchParams.next, "/admin");
  const access = await getAdminAccess();
  if (access.status === "ok") redirect(next);
  // Not an admin (for example a member who opened the admin sign-in by mistake): home page.
  if (access.status !== "needs_2fa") redirect("/");

  const supabase = getServerSupabase();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified") ?? null;

  return (
    <main className="container flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-sm">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">Two-step verification</h1>
        <p className="mt-3 text-sm text-mute">
          {factor
            ? "Enter the 6-digit code from your authenticator app to open the admin panel."
            : "Admins need an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password). Set it up once; after that you only enter a code."}
        </p>
        <TwoFactorForm mode={factor ? "verify" : "enroll"} factorId={factor?.id ?? null} next={next} />
      </div>
    </main>
  );
}

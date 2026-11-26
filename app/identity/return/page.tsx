import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { RETURN_PATH_RE, syncIdentityOnReturn } from "@/lib/identity";
import { loginPath } from "@/lib/login";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Identity check sent", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Where Stripe's identity page sends the member back. Signed in: straight on to where they
 * started. Signed out (for example the documents were taken on a phone after "Continue on
 * your phone", where they aren't signed in to Biddr): a plain confirmation, no sign-in wall.
 */
export default async function IdentityReturnPage({ searchParams }: { searchParams: { to?: string } }) {
  const to = searchParams.to && RETURN_PATH_RE.test(searchParams.to) ? searchParams.to : "/account/listings";
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (user) {
    await syncIdentityOnReturn(getAdminSupabase(), user.id);
    redirect(`${to}?identity=return`);
  }
  return (
    <main className="container flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-md space-y-4">
        <h1 className="font-wide text-2xl font-extrabold tracking-tight sm:text-3xl">Thanks, your documents are sent</h1>
        <p role="status" className="flex gap-3 rounded-md border border-line bg-panel p-3 text-sm">
          <StatusIcon kind="waiting" className="mt-0.5 size-5" />
          <span>Stripe is checking your identity. This usually takes a few minutes, and we&apos;ll notify you when it&apos;s done.</span>
        </p>
        <p className="text-sm text-mute">
          If you started on another device, you can close this page and continue there. Nothing else is needed here.
        </p>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={loginPath(to)}>Sign in to Biddr on this device</Link>
        </Button>
      </div>
    </main>
  );
}

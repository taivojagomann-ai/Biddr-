import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/login";
import { isProfileComplete } from "@/lib/profile";
import { safeNext } from "@/lib/redirect";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import type { Country } from "@/lib/types";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

type OwnProfile = {
  full_name: string | null;
  username: string | null;
  country: Country | null;
  phone: string | null;
};

type TermsStatus = { bidding_terms_version: string | null; bidding_terms_accepted_at: string | null };

const acceptedFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Tallinn" });

export default async function AccountSetupPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  const next = safeNext(searchParams.next);
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(`/account/setup${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`));

  // full_name and phone are not readable through column grants, so read them with the
  // service role, strictly limited to the signed-in user's own row. Only these plain
  // values reach the client component, never the client or its key.
  const { data: profile } = await getAdminSupabase()
    .from("profiles")
    .select("full_name, username, country, phone")
    .eq("id", user.id)
    .maybeSingle<OwnProfile>();

  const isNew = !isProfileComplete(profile);

  // Read separately, so the profile form still works if 0008 hasn't been run yet.
  const [{ data: terms }, { data: currentVersion }] = await Promise.all([
    getAdminSupabase()
      .from("profiles")
      .select("bidding_terms_version, bidding_terms_accepted_at")
      .eq("id", user.id)
      .maybeSingle<TermsStatus>(),
    supabase.rpc("current_bidding_terms_version"),
  ]);
  const acceptedCurrent = Boolean(
    terms?.bidding_terms_accepted_at && terms.bidding_terms_version && terms.bidding_terms_version === currentVersion,
  );

  return (
    <main className="container flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-md">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">
          {isNew ? "Finish your profile" : "Your profile"}
        </h1>
        <p className="mt-3 text-sm text-mute">
          {isNew
            ? "A few details before you bid, comment or list a car. Only your username and country are shown publicly."
            : "Only your username and country are shown publicly."}
        </p>
        <SetupForm
          isNew={isNew}
          next={next}
          defaults={{
            username: profile?.username ?? "",
            full_name: profile?.full_name ?? "",
            country: profile?.country ?? "",
            phone: profile?.phone ?? "",
          }}
        />

        <section aria-labelledby="terms-status-heading" className="mt-10 border-t border-line pt-6">
          <h2 id="terms-status-heading" className="text-sm font-semibold">
            Bidding terms
          </h2>
          <p className="mt-1 text-sm text-mute">
            {acceptedCurrent && terms?.bidding_terms_accepted_at ? (
              <>
                Bidding terms accepted on {acceptedFmt.format(new Date(terms.bidding_terms_accepted_at))} (version{" "}
                {terms.bidding_terms_version}).
              </>
            ) : terms?.bidding_terms_accepted_at ? (
              <>
                Not yet accepted: you accepted version {terms.bidding_terms_version}, and the terms have changed since.
                You&apos;ll be asked again before your next bid.
              </>
            ) : (
              <>Not yet accepted. You&apos;ll be asked before your first bid.</>
            )}{" "}
            <a href="/terms/bidding" className="text-chalk underline underline-offset-4 hover:text-signal">
              Read the bidding terms
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}

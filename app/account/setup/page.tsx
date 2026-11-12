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

export default async function AccountSetupPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  const next = safeNext(searchParams.next);
  const { data: { user } } = await getServerSupabase().auth.getUser();
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
      </div>
    </main>
  );
}

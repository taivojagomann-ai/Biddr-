import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bidding terms" };
export const dynamic = "force-dynamic";

// Placeholder until the terms are written with a lawyer. Do not add legal wording here.
export default async function BiddingTermsPage() {
  // The version lives in the database (current_bidding_terms_version(), 0008), so this
  // page always shows the version bidders are asked to accept.
  const { data } = await getServerSupabase().rpc("current_bidding_terms_version");
  const version = typeof data === "string" ? data : null;

  return (
    <main className="container max-w-2xl py-12 sm:py-16">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">Bidding terms</h1>
      <p role="note" className="mt-4 rounded-md border border-signal/50 bg-signal/10 px-3 py-2 text-sm font-semibold">
        Draft. Final terms will be provided before launch.
      </p>
      <p className="mt-4 text-sm text-mute">Version: {version ?? "not available"}</p>
      <p className="mt-6 text-mute">[Full bidding terms to be written with a lawyer]</p>
    </main>
  );
}

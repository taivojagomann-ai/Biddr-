import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loginPath } from "@/lib/login";
import { isProfileComplete } from "@/lib/profile";
import { loadSellerInfo } from "@/lib/seller-info";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import type { Country } from "@/lib/types";
import { SellForm } from "./sell-form";

export const metadata: Metadata = { title: "Sell your car" };
export const dynamic = "force-dynamic";

export default async function SellPage() {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/sell"));

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, country, created_at")
    .eq("id", user.id)
    .maybeSingle<{ username: string | null; country: Country | null; created_at: string }>();
  if (!isProfileComplete(profile)) redirect("/account/setup?next=/sell");

  // Blocked from selling after a report (0026): say so instead of showing the form.
  const { data: block } = await getAdminSupabase()
    .from("profiles")
    .select("selling_blocked_at, selling_block_reason")
    .eq("id", user.id)
    .maybeSingle<{ selling_blocked_at: string | null; selling_block_reason: string | null }>();
  if (block?.selling_blocked_at) {
    return (
      <main className="container max-w-2xl py-12">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">Sell your car</h1>
        <section aria-labelledby="selling-blocked" className="mt-6 rounded-lg border border-signal/50 bg-signal/10 p-4 text-sm">
          <h2 id="selling-blocked" className="font-bold">
            You can&apos;t list cars right now
          </h2>
          <p className="mt-1">
            {block.selling_block_reason ?? "Biddr has blocked your account from selling."} Contact Biddr if you think this is
            a mistake.
          </p>
        </section>
      </main>
    );
  }

  // For the preview's seller card: the same public facts buyers will see.
  const sellerStats = await loadSellerInfo({ seller_id: user.id, seller_type: "private", dealer_name: null, dealer_registry_code: null });

  // The form also shows the full-width listing preview (?preview=1), so the page
  // width is set inside it.
  return (
    <main>
      <Suspense>
        <SellForm
          userId={user.id}
          defaultCountry={profile?.country ?? ""}
          sellerStats={sellerStats}
          intro={
            <>
              <h1 className="font-wide text-3xl font-extrabold tracking-tight">Sell your car</h1>
              <p className="mt-2 max-w-xl text-sm text-mute">
                Tell us about the car and add photos. We review every listing and then schedule the auction.
                Your answers are saved on this device as you go.
              </p>
            </>
          }
        />
      </Suspense>
    </main>
  );
}

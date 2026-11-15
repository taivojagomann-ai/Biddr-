import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loginPath } from "@/lib/login";
import { isProfileComplete } from "@/lib/profile";
import { loadSellerInfo } from "@/lib/seller-info";
import { getServerSupabase } from "@/lib/supabase/server";
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

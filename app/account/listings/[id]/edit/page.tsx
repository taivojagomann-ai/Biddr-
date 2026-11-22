import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Camera } from "lucide-react";
import { DetailsForm } from "@/app/admin/auctions/[id]/details-form";
import { ListingForm } from "@/app/admin/auctions/[id]/listing-form";
import { Section } from "@/app/admin/auctions/[id]/section";
import { findMake } from "@/lib/data/car-makes";
import { asServiceHistory, asTextList, toServiceRows } from "@/lib/listing-details";
import { loginPath } from "@/lib/login";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import type { Auction } from "@/lib/types";
import { updateMyDetails, updateMyListing } from "./actions";
import { PriceForm } from "./price-form";

export const metadata: Metadata = { title: "Edit listing", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const withBlank = (list: string[]) => (list.length ? list : [""]);

/**
 * "Edit listing" (DECISIONS.md point 17): the seller corrects the car's details and the
 * listing's text while it's in review. Photos stay as they are: they are what the
 * listing is checked against.
 */
export default async function EditListingPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(`/account/listings/${params.id}/edit`));

  const admin = getAdminSupabase();
  const { data: a } = await admin.from("auctions").select("*").eq("id", params.id).eq("seller_id", user.id).maybeSingle<Auction>();
  if (!a) notFound();
  const { data: priv } = await admin.from("auction_private").select("requested_reserve").eq("auction_id", a.id).maybeSingle<{ requested_reserve: number | null }>();
  const editable = a.status === "draft";
  const restored = a.condition_type === "restored_accident";

  return (
    <main className="container max-w-3xl py-8">
      <Link href="/account/listings" className="inline-flex min-h-11 items-center text-sm text-mute hover:text-chalk">
        ← My listings
      </Link>
      <h1 className="mt-1 font-wide text-2xl font-extrabold tracking-tight sm:text-3xl">Edit listing</h1>
      <p className="mt-1 text-sm text-mute">{a.title}</p>

      {!editable ? (
        <p role="status" className="mt-6 rounded-md border border-line bg-panel p-3 text-sm">
          This listing can&apos;t be changed any more: it has been scheduled or has ended. If something is wrong, write to Biddr.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-2 rounded-md border border-line bg-panel p-3 text-sm">
            <p>Fix a typo or a wrong detail while Biddr reviews your listing. Each part saves on its own.</p>
            <p className="flex gap-2 text-mute">
              <Camera aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Photos can&apos;t be changed here: they, your registration certificate and the photos at the car are what the
                listing is checked against. When the VIN or the mileage changes, the checks run again against them.
              </span>
            </p>
            <p className="text-mute">If Biddr has already approved the listing, a change sends it back for review.</p>
          </div>

          <div className="mt-6 space-y-6">
            <Section id="edit-car" title="Car and listing">
              <ListingForm
                auctionId={a.id}
                vin={a.vin}
                restored={restored}
                seller
                action={updateMyListing}
                initial={{
                  title: a.title,
                  year: String(a.year),
                  vin: a.vin,
                  make: a.make,
                  makeOther: Boolean(a.make_other) || !findMake(a.make),
                  model: a.model,
                  variant: a.variant ?? "",
                  engine: a.engine ?? "",
                  transmission: a.transmission ?? "",
                  drivetrain: a.drivetrain === "AWD" || a.drivetrain === "FWD" ? a.drivetrain : "RWD",
                  exteriorColor: a.exterior_color ?? "",
                  mileageKm: String(a.mileage_km),
                  city: a.location_city,
                  country: a.location_country,
                  damageSummary: a.damage_history_summary ?? "",
                  videoUrl: a.video_url ?? "",
                  bodyStyle: a.body_style ?? "",
                  interiorColor: a.interior_color ?? "",
                  ownerCount: a.owner_count ? String(a.owner_count) : "",
                  sellerType: a.seller_type === "dealer" ? "dealer" : "private",
                  dealerName: a.dealer_name ?? "",
                  dealerRegistryCode: a.dealer_registry_code ?? "",
                  registrationCountry: a.registration_country ?? "",
                  isRegistered: a.is_registered === null || a.is_registered === undefined ? "" : a.is_registered ? "yes" : "no",
                }}
              />
            </Section>

            <Section id="edit-details" title="Details" intro="Highlights, equipment, modifications, known flaws, service history, items included and your notes.">
              <DetailsForm
                auctionId={a.id}
                seller
                action={updateMyDetails}
                initial={{
                  highlights: withBlank(asTextList(a.highlights)),
                  equipment: withBlank(asTextList(a.equipment)),
                  modifications: withBlank(asTextList(a.modifications)),
                  noModifications: Boolean(a.no_modifications),
                  knownFlaws: withBlank(asTextList(a.known_flaws)),
                  noKnownFlaws: Boolean(a.no_known_flaws),
                  serviceHistory: toServiceRows(asServiceHistory(a.service_history)),
                  itemsIncluded: withBlank(asTextList(a.items_included)),
                  sellerNotes: a.seller_notes ?? "",
                }}
              />
            </Section>

            <Section id="edit-price" title="Price">
              <PriceForm auctionId={a.id} initial={{ startingBid: a.starting_bid, reserve: priv?.requested_reserve ?? null }} />
            </Section>
          </div>
        </>
      )}
    </main>
  );
}

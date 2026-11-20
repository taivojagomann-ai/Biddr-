import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBidderStatus, unmetRequirement } from "@/lib/bidder";
import { loginPath } from "@/lib/login";
import { INFO_LINE, MASKING_NOTE, messageError } from "@/lib/messages";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import type { GalleryUrls } from "@/lib/types";
import { ContactForm } from "./contact-form";
import { TermsGate } from "./terms-gate";

export const metadata: Metadata = { title: "Contact the seller", robots: { index: false } };
export const dynamic = "force-dynamic";

const HOLD_EUR = Number(process.env.BID_HOLD_AMOUNT_EUR ?? 500);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Contact seller" (DECISIONS.md point 14): the same requirements as bidding (signed in,
 * complete profile, accepted bidding terms, not blocked), no card hold. A buyer who
 * already has a conversation about this car goes straight to it.
 */
export default async function ContactSellerPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const self = `/auctions/${params.id}/contact`;
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(self));

  const { data: auction } = await supabase
    .from("auctions")
    .select("id, title, status, seller_id, is_demo, ends_at, gallery_urls")
    .eq("id", params.id)
    .maybeSingle<{ id: string; title: string; status: string; seller_id: string; is_demo: boolean; ends_at: string | null; gallery_urls: GalleryUrls }>();
  if (!auction) notFound();

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("auction_id", auction.id)
    .eq("buyer_id", user.id)
    .maybeSingle<{ id: string }>();
  if (existing) redirect(`/account/messages/${existing.id}`);

  const back = `/auctions/${auction.id}`;
  const open = (auction.status === "upcoming" || auction.status === "live") && Boolean(auction.ends_at && Date.parse(auction.ends_at) > Date.now());
  const cover = auction.gallery_urls?.exterior?.[0];

  let blocker: { title: string; text: string; action?: { href: string; label: string } } | null = null;
  let termsVersion: string | null = null;
  if (auction.seller_id === user.id) blocker = { title: "This is your car", text: "Buyers can contact you from this page. You'll find their messages in Messages." };
  else if (auction.is_demo) blocker = { title: "This is a demo listing", text: messageError("DEMO_AUCTION") };
  else if (!open) blocker = { title: "This auction has ended", text: messageError("AUCTION_NOT_OPEN") };
  else {
    const status = await getBidderStatus(supabase);
    const unmet = status ? unmetRequirement(status) : "PROFILE_INCOMPLETE";
    if (unmet === "PROFILE_INCOMPLETE") {
      blocker = {
        title: "Finish your profile first",
        text: "To contact sellers you need the same profile as for bidding: a username, full name, country and phone number. Only your username and country are shown publicly.",
        action: { href: `/account/setup?next=${encodeURIComponent(self)}`, label: "Finish your profile" },
      };
    } else if (unmet === "TERMS_NOT_ACCEPTED") {
      termsVersion = status!.current_version;
    } else if (unmet === "BIDDING_BLOCKED") {
      blocker = { title: "You can't contact sellers right now", text: messageError("BIDDING_BLOCKED") };
    } else {
      // Messaging blocks aren't readable by members (column grants): check this member's own row.
      const { data: me } = await getAdminSupabase().from("profiles").select("messaging_blocked_at").eq("id", user.id).maybeSingle<{ messaging_blocked_at: string | null }>();
      if (me?.messaging_blocked_at) blocker = { title: "You can't contact sellers right now", text: messageError("MESSAGING_BLOCKED") };
    }
  }

  return (
    <main className="container max-w-2xl py-8">
      <Link href={back} className="inline-flex min-h-11 items-center text-sm text-mute hover:text-chalk">
        ← Back to the car
      </Link>
      <div className="mt-2 flex items-center gap-3">
        {cover ? (
          <div className="relative aspect-[4/3] w-20 shrink-0 overflow-hidden rounded-md bg-panel">
            <Image src={cover} alt="" fill sizes="80px" className="object-cover" />
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="font-wide text-2xl font-extrabold tracking-tight">Contact the seller</h1>
          <p className="truncate text-sm text-mute">{auction.title}</p>
        </div>
      </div>

      <p role="note" className="mt-5 flex gap-2 rounded-md border border-signal/40 bg-signal/10 p-3 text-sm">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
        <span>{INFO_LINE}</span>
      </p>

      <div className="mt-6">
        {blocker ? (
          <section aria-labelledby="contact-blocked" className="rounded-lg border border-line bg-panel p-4">
            <h2 id="contact-blocked" className="text-lg font-bold">
              {blocker.title}
            </h2>
            <p className="mt-1 text-sm text-mute">{blocker.text}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {blocker.action ? (
                <Button asChild>
                  <Link href={blocker.action.href}>{blocker.action.label}</Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href={back}>Back to the car</Link>
              </Button>
            </div>
          </section>
        ) : termsVersion ? (
          <TermsGate version={termsVersion} holdEur={HOLD_EUR} />
        ) : (
          <>
            <p className="mb-4 text-sm text-mute">
              Your message goes to the seller only. {MASKING_NOTE} Public questions are better asked under the listing.
            </p>
            <ContactForm auctionId={auction.id} />
          </>
        )}
      </div>
    </main>
  );
}

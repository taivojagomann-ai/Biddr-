import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Car, ChevronRight, Eye } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/format";
import { loginPath } from "@/lib/login";
import { STATUS_LABELS } from "@/lib/sell";
import { withdrawOption } from "@/lib/withdraw";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import type { Auction, AuctionPrivate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HistoryRejectedPanel } from "./history-panel";
import { DecisionPanel } from "./decision-panel";
import { WithdrawActions } from "./withdraw-actions";

export const metadata: Metadata = { title: "My listings" };
export const dynamic = "force-dynamic";

type ListingRow = Pick<
  Auction,
  "id" | "title" | "make" | "status" | "current_bid" | "bid_count" | "gallery_urls" | "created_at" | "damage_history_summary"
>;

type PrivateRow = Pick<
  AuctionPrivate,
  | "auction_id" | "rejection_reason" | "withdraw_request_status" | "inspection_review_note"
  | "seller_decision_required" | "seller_decision_deadline" | "seller_decision"
  | "history_review_status" | "history_review_note"
>;

const STATUS_STYLES: Record<Auction["status"], string> = {
  draft: "border-line text-mute",
  upcoming: "border-line text-chalk",
  live: "border-signal text-signal",
  sold: "border-verified text-verified",
  ended: "border-line text-mute",
  reserve_not_met: "border-line text-mute",
  rejected: "border-signal/60 text-signal",
  withdrawn: "border-line text-mute",
};

export default async function MyListingsPage() {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/account/listings"));

  const { data } = await supabase
    .from("auctions")
    .select("id, title, make, status, current_bid, bid_count, gallery_urls, created_at, damage_history_summary")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .returns<ListingRow[]>();
  const listings = data ?? [];

  // Rejection reasons and withdrawal requests live in auction_private, which only admins
  // can read. Read them with the service role, strictly for this seller's own listings.
  const privates = new Map<string, PrivateRow>();
  if (listings.length) {
    const { data: rows } = await getAdminSupabase()
      .from("auction_private")
      .select(
        "auction_id, rejection_reason, withdraw_request_status, inspection_review_note, seller_decision_required, seller_decision_deadline, seller_decision, history_review_status, history_review_note, auction:auctions!inner(seller_id)",
      )
      .in("auction_id", listings.map((l) => l.id))
      .eq("auction.seller_id", user.id)
      .returns<PrivateRow[]>();
    for (const r of rows ?? []) privates.set(r.auction_id, r);
  }

  return (
    <main className="container max-w-3xl py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">My listings</h1>
        <Button asChild size="sm">
          <Link href="/sell">Sell a car</Link>
        </Button>
      </div>

      {listings.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-line p-8 text-center">
          <Car aria-hidden className="mx-auto size-8 text-mute" />
          <p className="mt-3 font-semibold">You haven&apos;t listed a car yet</p>
          <p className="mt-1 text-sm text-mute">Have the registration document and your photos ready before you start.</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-panel">
          {listings.map((l) => {
            const cover = l.gallery_urls?.exterior?.[0];
            const isPublic = l.status !== "draft" && l.status !== "rejected";
            const priv = privates.get(l.id);
            const reason = priv?.rejection_reason ?? undefined;
            // After a rejected dealer report the seller chooses how to continue (0016).
            const deciding = l.status === "draft" && Boolean(priv?.seller_decision_required);
            const body = (
              <>
                <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-md bg-asphalt sm:w-32">
                  {cover ? (
                    <Image src={cover} alt="" fill sizes="128px" className="object-cover" />
                  ) : (
                    <Car aria-hidden className="absolute inset-0 m-auto size-6 text-mute" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className={cn("rounded-sm border px-1.5 py-0.5 text-xs font-semibold", STATUS_STYLES[l.status])}>
                      {deciding ? "Waiting for your decision" : STATUS_LABELS[l.status]}
                    </span>
                    {l.current_bid ? (
                      <span className="text-mute">
                        {l.status === "live" ? "Current bid" : "High bid"}{" "}
                        <span className="font-semibold text-chalk">{formatEur(l.current_bid)}</span>
                      </span>
                    ) : null}
                  </p>
                  {l.status === "rejected" ? (
                    <p className="mt-2 rounded-md border border-line bg-asphalt/60 px-2.5 py-2 text-sm">
                      <span className="text-mute">Why: </span>
                      {reason ?? "We couldn't accept this listing. Contact us for details."}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-mute">
                    Submitted <LocalDateTime iso={l.created_at} dateOnly />
                  </p>
                  {isPublic ? null : (
                    <Link
                      href={`/auctions/${l.id}`}
                      className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-chalk underline underline-offset-4 hover:text-signal"
                    >
                      <Eye aria-hidden className="size-4" />
                      Preview<span className="sr-only"> {l.title}</span>
                    </Link>
                  )}
                </div>
                {isPublic ? <ChevronRight aria-hidden className="size-5 shrink-0 text-mute" /> : null}
              </>
            );
            const requestStatus = priv?.withdraw_request_status ?? null;
            return (
              <li key={l.id}>
                {isPublic ? (
                  <Link href={`/auctions/${l.id}`} className="flex items-center gap-4 p-3 hover:bg-asphalt/40">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-4 p-3">{body}</div>
                )}
                {/* Outside the link: no buttons inside links. */}
                <div className="space-y-3 px-3 pb-3 empty:hidden sm:pl-[9.25rem]">
                  {l.status === "draft" && (deciding || priv?.seller_decision) ? (
                    <DecisionPanel
                      auctionId={l.id}
                      userId={user.id}
                      title={l.title}
                      make={l.make}
                      required={deciding}
                      reason={priv?.inspection_review_note ?? null}
                      deadline={priv?.seller_decision_deadline ?? null}
                      choice={priv?.seller_decision ?? null}
                    />
                  ) : null}
                  {/* Rejected, or sent again after a rejection (the reason stays until the next review). */}
                  {l.status === "draft" &&
                  (priv?.history_review_status === "rejected" || (priv?.history_review_status === "pending" && priv.history_review_note)) ? (
                    <HistoryRejectedPanel
                      auctionId={l.id}
                      userId={user.id}
                      title={l.title}
                      reason={priv.history_review_note}
                      damageSummary={l.damage_history_summary}
                      resubmitted={priv.history_review_status === "pending"}
                    />
                  ) : null}
                  {/* While deciding, Withdraw is one of the panel's three choices. */}
                  {deciding ? null : (
                    <WithdrawActions
                      auctionId={l.id}
                      title={l.title}
                      option={withdrawOption(l.status, requestStatus)}
                      declined={requestStatus === "declined"}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

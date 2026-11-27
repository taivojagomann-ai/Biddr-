import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Car, ChevronRight, Eye, MessageCircleQuestion, Pencil } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/format";
import { loginPath } from "@/lib/login";
import { STATUS_LABELS } from "@/lib/sell";
import { withdrawOption } from "@/lib/withdraw";
import { unansweredLabel, unansweredQuestions } from "@/lib/unanswered-questions";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import type { Auction, AuctionPrivate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HistoryRejectedPanel } from "./history-panel";
import { nextBidder, type SecondChanceOffer } from "@/lib/after-sale";
import { contactForPaidPayment } from "@/lib/contacts";
import type { BuyerPaymentRow } from "@/lib/settlement";
import { SalePanel, type SaleState } from "./sale-panel";
import type { ReportStatus } from "@/lib/reports";
import { DecisionPanel } from "./decision-panel";
import { WithdrawActions } from "./withdraw-actions";
import { IdentityPanel } from "@/components/identity-panel";
import { IDENTITY_COLUMNS, syncIdentityOnReturn, type IdentityRow } from "@/lib/identity";
import { ListingTiming } from "./listing-timing";
import { VerifyStatus } from "./verify-status";
import { IDENTITY_REQUEST } from "@/lib/listing-checks/seller-status";
import { loadVerificationModels } from "@/lib/listing-checks/load-model";
import type { VerificationModel } from "@/lib/listing-checks/verification-model";
import { Suspense } from "react";
import { activePaidSeats, seatSettings } from "@/lib/premium-seat";
import { FeatureCar, SeatPaymentReturn, type FeatureOffer } from "./feature-car";

export const metadata: Metadata = { title: "My listings" };
export const dynamic = "force-dynamic";

type ListingRow = Pick<
  Auction,
  "id" | "title" | "make" | "status" | "current_bid" | "bid_count" | "gallery_urls" | "created_at" | "starts_at" | "ends_at" | "damage_history_summary" | "premium_seat_until"
> & { relisted_from: string | null };

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

export default async function MyListingsPage({ searchParams }: { searchParams?: { identity?: string } }) {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/account/listings"));
  // The first render's clock for the time-left chips (they then follow the server-corrected clock).
  const now = Date.now();

  const { data } = await supabase
    .from("auctions")
    .select("id, title, make, status, current_bid, bid_count, gallery_urls, created_at, starts_at, ends_at, premium_seat_until, damage_history_summary, relisted_from")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .returns<ListingRow[]>();
  const listings = data ?? [];
  const unanswered = await unansweredQuestions(supabase, user.id);

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

  // Fake-listing checks for listings in review (admin-only tables: the service role,
  // strictly for this seller's own drafts) and the seller's identity status.
  const drafts = listings.filter((l) => l.status === "draft").map((l) => l.id);
  let identityStatus = "none";
  let identity: IdentityRow | null = null;
  let models = new Map<string, VerificationModel>();
  const approved = new Set<string>();
  {
    const admin = getAdminSupabase();
    // Back from Stripe's page: read its state first.
    if (searchParams?.identity === "return") await syncIdentityOnReturn(admin, user.id);
    const draftRows = listings.filter((l) => l.status === "draft");
    const [loaded, { data: me }, { data: approvals }] = await Promise.all([
      loadVerificationModels(admin, user.id, draftRows.map((l) => ({ id: l.id, status: l.status, created_at: l.created_at }))),
      admin.from("profiles").select(IDENTITY_COLUMNS).eq("id", user.id).maybeSingle<IdentityRow>(),
      drafts.length
        ? admin.from("listing_verifications").select("auction_id").in("auction_id", drafts).eq("seller_id", user.id).not("content_approved_at", "is", null).returns<{ auction_id: string }[]>()
        : Promise.resolve({ data: [] as { auction_id: string }[] }),
    ]);
    models = loaded;
    for (const r of approvals ?? []) approved.add(r.auction_id);
    identity = me ?? null;
    identityStatus = me?.identity_status ?? "none";
  }
  // Premium seats (0036): "Feature this car" for scheduled and live auctions.
  const offers = new Map<string, FeatureOffer>();
  const seatable = listings.filter((l) => l.status === "upcoming" || l.status === "live");
  {
    const admin = getAdminSupabase();
    const ids = listings.map((l) => l.id);
    const [settings, active, { data: seats }, { data: waiting }] = await Promise.all([
      seatSettings(admin),
      activePaidSeats(admin),
      ids.length
        ? admin.from("premium_seat_purchases").select("id, auction_id").in("auction_id", ids).eq("seller_id", user.id).in("status", ["paid"]).returns<{ id: string; auction_id: string }[]>()
        : Promise.resolve({ data: [] as { id: string; auction_id: string }[] }),
      seatable.length
        ? admin.from("premium_seat_waitlist").select("auction_id").in("auction_id", seatable.map((l) => l.id)).is("notified_at", null).returns<{ auction_id: string }[]>()
        : Promise.resolve({ data: [] as { auction_id: string }[] }),
    ]);
    const purchaseIds = (seats ?? []).map((p) => p.id);
    const [{ data: invoiceRows }, { data: receiptRows }] = purchaseIds.length
      ? await Promise.all([
          supabase.from("invoices").select("id, number, buyer_payment_id").in("buyer_payment_id", purchaseIds).eq("kind", "invoice").returns<{ id: string; number: string; buyer_payment_id: string }[]>(),
          supabase.from("receipts").select("id, number, buyer_payment_id").in("buyer_payment_id", purchaseIds).eq("type", "payment").returns<{ id: string; number: string; buyer_payment_id: string }[]>(),
        ])
      : [{ data: [] as { id: string; number: string; buyer_payment_id: string }[] }, { data: [] as { id: string; number: string; buyer_payment_id: string }[] }];
    const seatOf = new Map((seats ?? []).map((p) => [p.auction_id, p.id]));
    const waitingSet = new Set((waiting ?? []).map((w) => w.auction_id));
    for (const l of listings) {
      const purchaseId = seatOf.get(l.id);
      const until = l.premium_seat_until && Date.parse(l.premium_seat_until) > now ? l.premium_seat_until : null;
      if (until && (l.status === "upcoming" || l.status === "live")) {
        const inv = (invoiceRows ?? []).find((r) => r.buyer_payment_id === purchaseId);
        const rec = (receiptRows ?? []).find((r) => r.buyer_payment_id === purchaseId);
        offers.set(l.id, {
          state: "featured",
          priceEur: settings.priceEur,
          until,
          paid: Boolean(purchaseId),
          invoice: inv ? { id: inv.id, number: inv.number } : null,
          receipt: rec ? { id: rec.id, number: rec.number } : null,
        });
      } else if ((l.status === "upcoming" || l.status === "live") && l.ends_at && Date.parse(l.ends_at) > now) {
        offers.set(l.id, active >= settings.limit ? { state: "full", priceEur: settings.priceEur, waitlisted: waitingSet.has(l.id) } : { state: "available", priceEur: settings.priceEur });
      }
    }
  }

  const identityRequested = identityStatus !== "verified" && identityStatus !== "pending" && approved.size > 0;

  // Sold cars: the buyer's premium, the buyer's contact details once it's paid, and what
  // the seller can do when the buyer didn't pay (DECISIONS.md point 12).
  const sales = new Map<string, SaleState>();
  const sold = listings.filter((l) => l.status === "sold");
  if (sold.length) {
    const ids = sold.map((l) => l.id);
    const [{ data: paymentRows }, { data: offerRows }] = await Promise.all([
      supabase.from("buyer_payments").select("*").in("auction_id", ids).eq("seller_id", user.id).order("created_at", { ascending: false }).returns<BuyerPaymentRow[]>(),
      supabase.from("second_chance_offers").select("*").in("auction_id", ids).eq("seller_id", user.id).order("created_at", { ascending: false }).returns<SecondChanceOffer[]>(),
    ]);
    const admin = getAdminSupabase();
    const paidIds = (paymentRows ?? []).filter((p) => p.status === "paid").map((p) => p.id);
    const { data: convRows } = paidIds.length
      ? await supabase.from("conversations").select("id, buyer_payment_id").in("buyer_payment_id", paidIds).returns<{ id: string; buyer_payment_id: string }[]>()
      : { data: [] };
    const conversationOf = new Map((convRows ?? []).map((c) => [c.buyer_payment_id, c.id]));
    const { data: reportRows } = paidIds.length
      ? await supabase.from("sale_reports").select("buyer_payment_id, status").in("buyer_payment_id", paidIds).order("created_at", { ascending: false }).returns<{ buyer_payment_id: string; status: ReportStatus }[]>()
      : { data: [] };
    const reportOf = new Map<string, ReportStatus>();
    for (const r of reportRows ?? []) if (!reportOf.has(r.buyer_payment_id)) reportOf.set(r.buyer_payment_id, r.status);
    for (const l of sold) {
      const payments = (paymentRows ?? []).filter((p) => p.auction_id === l.id);
      const offers = (offerRows ?? []).filter((o) => o.auction_id === l.id);
      const active = payments.find((p) => p.status !== "unpaid" && p.status !== "cancelled");
      const relist = listings.find((x) => x.relisted_from === l.id);
      const openOffer = offers.find((o) => o.status === "pending" || o.status === "accepted");
      let state: SaleState | null = null;
      if (active?.status === "paid") {
        state = { kind: "paid", paymentId: active.id, contact: await contactForPaidPayment(admin, user.id, active), completedAt: active.sale_completed_at ?? null, conversationId: conversationOf.get(active.id) ?? null, report: reportOf.get(active.id) ?? null };
      } else if (active?.status === "refunded") {
        state = { kind: "cancelled" };
      } else if (active) {
        state = { kind: "waiting", secondChance: Boolean(active.second_chance_offer_id) };
      } else if (relist) {
        state = { kind: "relisted", href: `/auctions/${relist.id}` };
      } else if (openOffer) {
        const payment = payments.find((p) => p.second_chance_offer_id === openOffer.id);
        state = { kind: "offered", amount: openOffer.amount, expiresAt: payment?.due_at ?? openOffer.expires_at, accepted: openOffer.status === "accepted" };
      } else if (payments.some((p) => p.status === "unpaid")) {
        const exclude = [user.id, ...payments.map((p) => p.winner_id), ...offers.map((o) => o.bidder_id)];
        const next = await nextBidder(admin, l.id, exclude);
        state = { kind: "unpaid", next: next ? { amount: next.amount, username: next.username } : null };
      } else if (payments.length) {
        state = { kind: "cancelled" };
      }
      if (state) sales.set(l.id, state);
    }
  }

  return (
    <main className="container max-w-3xl py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">My listings</h1>
        <Button asChild size="sm">
          <Link href="/sell">Sell a car</Link>
        </Button>
      </div>

      {searchParams?.identity === "return" && identityStatus === "pending" ? (
        <p role="status" className="mt-6 rounded-md border border-line bg-panel p-3 text-sm">
          Thanks. Stripe is checking your identity; this page updates when it&apos;s done (usually within a few minutes).
        </p>
      ) : null}
      <Suspense>
        <SeatPaymentReturn />
      </Suspense>
      {identityRequested ? (
        <section aria-labelledby="identity-request" className="mt-6 rounded-lg border border-signal/50 bg-panel p-4">
          <h2 id="identity-request" className="font-bold">
            {IDENTITY_REQUEST}
          </h2>
          <div className="mt-3">
            <IdentityPanel me={identity} returnTo="/account/listings" />
          </div>
        </section>
      ) : null}

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
                  {unanswered.get(l.id) ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-signal">
                      <MessageCircleQuestion aria-hidden className="size-4 shrink-0" />
                      {unansweredLabel(unanswered.get(l.id)!)}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-mute">
                    Submitted <LocalDateTime iso={l.created_at} dateOnly />
                  </p>
                  <ListingTiming id={l.id} initial={{ status: l.status, starts_at: l.starts_at, ends_at: l.ends_at }} initialNow={now} />
                  {isPublic ? null : (
                    <div className="mt-1 flex flex-wrap items-center gap-x-5">
                      <Link
                        href={`/auctions/${l.id}`}
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-chalk underline underline-offset-4 hover:text-signal"
                      >
                        <Eye aria-hidden className="size-4" />
                        Preview<span className="sr-only"> {l.title}</span>
                      </Link>
                      {l.status === "draft" ? (
                        <Link
                          href={`/account/listings/${l.id}/edit`}
                          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-chalk underline underline-offset-4 hover:text-signal"
                        >
                          <Pencil aria-hidden className="size-4" />
                          Edit<span className="sr-only"> {l.title}</span>
                        </Link>
                      ) : null}
                    </div>
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
                  {l.status === "draft" ? <VerifyStatus auctionId={l.id} title={l.title} model={models.get(l.id)!} /> : null}
                  {offers.has(l.id) ? <FeatureCar auctionId={l.id} title={l.title} offer={offers.get(l.id)!} /> : null}
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
                  {l.status === "sold" && sales.has(l.id) ? <SalePanel auctionId={l.id} title={l.title} state={sales.get(l.id)!} /> : null}
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

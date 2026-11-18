import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { ContactCard } from "@/components/contact-card";
import { LocalDateTime } from "@/components/local-date-time";
import { contactForPaidPayment, type PartyContact } from "@/lib/contacts";
import { formatEur } from "@/lib/format";
import { loginPath } from "@/lib/login";
import { PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE } from "@/lib/pricing";
import type { InvoiceKind } from "@/lib/invoice/issue";
import type { SecondChanceOffer } from "@/lib/after-sale";
import { SELLER_PAYMENT_DAYS, type BuyerPaymentRow } from "@/lib/settlement";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { CompletePayment, PaymentReturn } from "./complete-payment";
import { OfferButtons } from "./offer-buttons";

export const metadata: Metadata = { title: "My purchases" };
export const dynamic = "force-dynamic";

type Row = BuyerPaymentRow & { auction: { id: string; title: string } | null };

/** The payment status in plain words. */
function statusText(r: BuyerPaymentRow): string {
  switch (r.status) {
    case "pending":
      return "Processing: we're charging the buyer's premium to your card.";
    case "paid":
      return "Paid";
    case "action_required":
      return "Your bank needs you to confirm the payment.";
    case "failed":
      return `Payment failed${r.failure_reason ? `: ${r.failure_reason}` : "."}`;
    case "refunded":
      return "Refunded";
    case "cancelled":
      return r.second_chance_offer_id ? "Not paid in time: the offer ended." : "Cancelled";
    case "unpaid":
      return "Not paid in time: the sale was cancelled.";
  }
}

const sellerPaymentDue = (paidAt: string) => new Date(Date.parse(paidAt) + SELLER_PAYMENT_DAYS * 86_400_000).toISOString();

export default async function PurchasesPage() {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/account/purchases"));

  // RLS: only the winner's (and seller's) own rows; here only the ones this user won.
  const { data } = await supabase
    .from("buyer_payments")
    .select("*, auction:auctions(id, title)")
    .eq("winner_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Row[]>();
  const rows = data ?? [];

  // Second-chance offers waiting for this member's answer (RLS: their own).
  const { data: offerRows } = await supabase
    .from("second_chance_offers")
    .select("*, auction:auctions(id, title)")
    .eq("bidder_id", user.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .returns<(SecondChanceOffer & { auction: { id: string; title: string } | null })[]>();
  const offers = offerRows ?? [];

  // Blocked from bidding (a premium not paid in time): say so, with the reason.
  const { data: bidder } = await supabase.rpc("bidder_status");
  const blocked = (bidder as { blocked?: boolean; blocked_reason?: string | null } | null) ?? null;

  // This winner's invoices and credit notes (RLS: their own only).
  const { data: invoiceRows } = rows.length
    ? await supabase
        .from("invoices")
        .select("id, number, kind, buyer_payment_id")
        .in("buyer_payment_id", rows.map((r) => r.id))
        .returns<{ id: string; number: string; kind: InvoiceKind; buyer_payment_id: string }[]>()
    : { data: [] };
  const docs = new Map<string, { id: string; number: string; kind: InvoiceKind }[]>();
  for (const d of invoiceRows ?? []) docs.set(d.buyer_payment_id, [...(docs.get(d.buyer_payment_id) ?? []), d]);

  // Contact details only for paid purchases, read on the server for this winner only.
  const admin = getAdminSupabase();
  const contacts = new Map<string, PartyContact>();
  for (const r of rows) {
    const c = await contactForPaidPayment(admin, user.id, r);
    if (c) contacts.set(r.id, c);
  }

  return (
    <main className="container max-w-3xl py-10">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">My purchases</h1>
      <p className="mt-2 text-sm text-mute">
        Cars you won. Biddr charges the buyer&apos;s premium ({Math.round(PREMIUM_RATE * 100)}%, at least {formatEur(PREMIUM_MIN)}, at
        most {formatEur(PREMIUM_MAX)}); you pay the car itself directly to the seller.
      </p>
      <Suspense>
        <PaymentReturn />
      </Suspense>

      {blocked?.blocked ? (
        <section aria-labelledby="blocked-heading" className="mt-6 rounded-lg border border-signal/50 bg-signal/10 p-4 text-sm">
          <h2 id="blocked-heading" className="font-bold">Your bidding is blocked</h2>
          <p className="mt-1">
            {blocked.blocked_reason ?? "A buyer's premium wasn't paid in time."} You can&apos;t bid until Biddr lifts the
            block. Contact us if you think this is a mistake.
          </p>
        </section>
      ) : null}

      {offers.length ? (
        <section aria-labelledby="offers-heading" className="mt-8">
          <h2 id="offers-heading" className="text-lg font-bold">
            Second-chance offers
          </h2>
          <p className="mt-1 text-sm text-mute">
            The winner didn&apos;t pay, so the seller offers you the car at your highest bid. Accepting is binding: you pay
            the buyer&apos;s premium now, and the car to the seller directly.
          </p>
          <ul className="mt-3 space-y-3">
            {offers.map((o) => {
              const title = o.auction?.title ?? "Car";
              return (
                <li key={o.id} className="rounded-lg border border-signal/50 bg-panel p-4">
                  <article aria-labelledby={`offer-${o.id}`} className="space-y-3">
                    <h3 id={`offer-${o.id}`} className="font-bold">
                      <Link href={`/auctions/${o.auction_id}`} className="underline-offset-4 hover:underline">
                        {title}
                      </Link>
                    </h3>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
                      <dt className="text-mute">Price (your highest bid, paid to the seller)</dt>
                      <dd className="text-right tabular">{formatEur(o.amount)}</dd>
                      <dt className="text-mute">Buyer&apos;s premium (paid to Biddr now)</dt>
                      <dd className="text-right font-semibold tabular">{formatEur(o.premium_amount)}</dd>
                      <dt className="text-mute">Answer and pay by</dt>
                      <dd className="text-right">
                        <LocalDateTime iso={o.expires_at} />
                      </dd>
                    </dl>
                    <OfferButtons offerId={o.id} title={title} premium={formatEur(o.premium_amount)} />
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-panel p-4 text-sm text-mute">
          You haven&apos;t won a car yet.{" "}
          <Link href="/" className="font-semibold text-chalk underline underline-offset-4">
            See live auctions
          </Link>
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((r) => {
            const title = r.auction?.title ?? "Car";
            const captured = r.captured_from_hold ?? 0;
            const charged = r.status === "paid" ? r.premium_amount - captured : 0;
            const contact = contacts.get(r.id);
            const needsWinner = r.status === "action_required" || r.status === "failed";
            return (
              <li key={r.id} className="rounded-lg border border-line bg-panel p-4">
                <article aria-labelledby={`purchase-${r.id}`} className="space-y-3">
                  <h2 id={`purchase-${r.id}`} className="font-bold">
                    <Link href={`/auctions/${r.auction_id}`} className="underline-offset-4 hover:underline">
                      {title}
                    </Link>
                  </h2>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-mute">Winning bid (paid to the seller)</dt>
                    <dd className="text-right tabular">{formatEur(r.winning_bid)}</dd>
                    <dt className="text-mute">Buyer&apos;s premium</dt>
                    <dd className="text-right font-semibold tabular">{formatEur(r.premium_amount)}</dd>
                    {r.status === "paid" ? (
                      <>
                        <dt className="pl-3 text-mute">Taken from your card hold</dt>
                        <dd className="text-right tabular">{formatEur(captured)}</dd>
                        <dt className="pl-3 text-mute">Charged to your card</dt>
                        <dd className="text-right tabular">{formatEur(charged)}</dd>
                      </>
                    ) : null}
                    <dt className="text-mute">Status</dt>
                    <dd className={cn("text-right", needsWinner ? "font-semibold text-signal" : r.status === "paid" ? "font-semibold text-verified" : undefined)}>
                      {statusText(r)}
                    </dd>
                    {needsWinner && r.due_at ? (
                      <>
                        <dt className="text-mute">Please pay by</dt>
                        <dd className="text-right">
                          <LocalDateTime iso={r.due_at} />
                        </dd>
                      </>
                    ) : null}
                    {r.status === "paid" && r.paid_at ? (
                      <>
                        <dt className="text-mute">Paid on</dt>
                        <dd className="text-right">
                          <LocalDateTime iso={r.paid_at} />
                        </dd>
                        {r.sale_completed_at ? (
                          <>
                            <dt className="text-mute">Sale completed (confirmed by the seller)</dt>
                            <dd className="text-right">
                              <LocalDateTime iso={r.sale_completed_at} dateOnly />
                            </dd>
                          </>
                        ) : (
                          <>
                            <dt className="text-mute">Pay the seller for the car by</dt>
                            <dd className="text-right font-semibold">
                              <LocalDateTime iso={sellerPaymentDue(r.paid_at)} dateOnly />
                            </dd>
                          </>
                        )}
                      </>
                    ) : null}
                  </dl>
                  {r.status === "unpaid" ? (
                    <p className="rounded-md border border-line bg-asphalt/60 p-3 text-sm">
                      The buyer&apos;s premium wasn&apos;t paid within the time allowed, so this sale was cancelled
                      {captured > 0 ? ` and the ${formatEur(captured)} taken from your card hold isn't refunded` : ""}. Your
                      bidding is blocked until Biddr lifts it.
                    </p>
                  ) : null}
                  {r.status === "paid" || r.status === "refunded" || (r.status === "unpaid" && captured > 0) ? (
                    <InvoiceLinks docs={docs.get(r.id) ?? []} title={title} />
                  ) : null}
                  {needsWinner ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <CompletePayment auctionId={r.auction_id} title={title} />
                    </div>
                  ) : null}
                  {contact ? <ContactCard heading="Seller's contact details" contact={contact} idBase={`p-${r.id}`} /> : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/** The invoice (and the credit note after a refund), each opening in a new tab; the browser's viewer can save it. */
function InvoiceLinks({ docs, title }: { docs: { id: string; number: string; kind: InvoiceKind }[]; title: string }) {
  const sorted = [...docs].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "invoice" ? -1 : 1));
  if (!sorted.length) {
    return <p className="text-sm text-mute">Your invoice is being prepared. It appears here within a few minutes.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-x-5 text-sm">
      {sorted.map((d) => (
        <li key={d.id}>
          <a
            href={`/api/invoices/${d.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-signal"
          >
            {d.kind === "credit_note" ? "View credit note" : "View invoice"} {d.number} (PDF)
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only"> for {title} (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ContactCard } from "@/components/contact-card";
import { LocalDateTime } from "@/components/local-date-time";
import { contactForPaidPayment, type PartyContact } from "@/lib/contacts";
import { formatEur } from "@/lib/format";
import { loginPath } from "@/lib/login";
import { PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE } from "@/lib/pricing";
import type { BuyerPaymentRow } from "@/lib/settlement";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { CompletePayment, PaymentReturn } from "./complete-payment";

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
      return "Cancelled";
  }
}

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
                      </>
                    ) : null}
                  </dl>
                  {r.status === "paid" && r.receipt_url ? (
                    <p className="text-sm">
                      <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-signal">
                        View the receipt<span className="sr-only"> for {title} (opens in a new tab)</span>
                      </a>
                    </p>
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

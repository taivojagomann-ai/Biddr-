import Link from "next/link";
import { ContactCard } from "@/components/contact-card";
import { LocalDateTime } from "@/components/local-date-time";
import type { PartyContact } from "@/lib/contacts";
import { formatEur } from "@/lib/format";
import { CompleteSaleButton, SaleOptions } from "./sale-options";

/** What My listings shows under a sold car (DECISIONS.md point 12). */
export type SaleState =
  | { kind: "waiting"; secondChance: boolean }
  | { kind: "paid"; paymentId: string; contact: PartyContact | null; completedAt: string | null }
  | { kind: "cancelled" }
  | { kind: "offered"; amount: number; expiresAt: string; accepted: boolean }
  | { kind: "relisted"; href: string }
  | { kind: "unpaid"; next: { amount: number; username: string | null } | null };

export function SalePanel({ auctionId, title, state }: { auctionId: string; title: string; state: SaleState }) {
  switch (state.kind) {
    case "waiting":
      return (
        <p className="text-sm text-mute">
          {state.secondChance
            ? "The next bidder accepted your offer. Waiting for them to pay the buyer's premium; their contact details appear here once it's paid."
            : "Waiting for the buyer to pay the buyer's premium. Their contact details appear here once it's paid."}
        </p>
      );
    case "paid":
      return (
        <div className="space-y-3">
          {state.contact ? <ContactCard heading="Buyer's contact details" contact={state.contact} idBase={`l-${auctionId}`} /> : null}
          {state.completedAt ? (
            <p className="text-sm text-verified">
              Sale completed on <LocalDateTime iso={state.completedAt} dateOnly />.
            </p>
          ) : (
            <CompleteSaleButton paymentId={state.paymentId} title={title} />
          )}
        </div>
      );
    case "cancelled":
      return <p className="text-sm text-mute">This sale was cancelled by Biddr. Contact us if you have questions.</p>;
    case "offered":
      return (
        <p className="text-sm">
          {state.accepted ? "The next bidder accepted" : "Offered to the next bidder"} for {formatEur(state.amount)}. They have
          until <LocalDateTime iso={state.expiresAt} /> to {state.accepted ? "pay" : "accept and pay"} the buyer&apos;s premium.
        </p>
      );
    case "relisted":
      return (
        <p className="text-sm">
          The buyer didn&apos;t pay, so you relisted this car.{" "}
          <Link href={state.href} className="font-semibold underline underline-offset-4 hover:text-signal">
            See the new listing<span className="sr-only"> for {title}</span>
          </Link>
        </p>
      );
    case "unpaid":
      return (
        <section aria-labelledby={`unpaid-${auctionId}`} className="rounded-md border border-signal/50 bg-signal/10 p-3 text-sm">
          <h3 id={`unpaid-${auctionId}`} className="font-bold">
            The buyer didn&apos;t pay
          </h3>
          <p className="mt-1">
            The buyer&apos;s premium wasn&apos;t paid in time, so the sale was cancelled and the buyer can no longer bid. Choose
            what to do next:
          </p>
          <SaleOptions auctionId={auctionId} title={title} next={state.next} />
        </section>
      );
  }
}

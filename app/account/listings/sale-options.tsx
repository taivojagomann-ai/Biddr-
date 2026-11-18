"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmButton } from "@/app/admin/auctions/[id]/confirm-button";
import type { AfterSaleResult } from "@/lib/after-sale";
import { formatEur } from "@/lib/format";
import { completeSaleAction, offerToNextBidderAction, relistCarAction } from "./sale-actions";

function useRun() {
  const router = useRouter();
  const [result, setResult] = useState<AfterSaleResult | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (p: () => Promise<AfterSaleResult>) => {
    setPending(true);
    const r = await p();
    setPending(false);
    setResult(r);
    if (r.ok) router.refresh();
    return r.ok;
  };
  const error = result && !result.ok ? (
    <p role="alert" className="mt-3 text-sm text-signal">
      {result.error}
    </p>
  ) : null;
  const status = (
    <p role="status" className="text-sm">
      {result?.ok ? (
        <>
          {result.message}{" "}
          {result.href ? (
            <Link href={result.href} className="font-semibold underline underline-offset-4">
              Open it
            </Link>
          ) : null}
        </>
      ) : (
        ""
      )}
    </p>
  );
  return { run, pending, error, status };
}

/** The buyer didn't pay: offer the car to the next bidder, or relist it. */
export function SaleOptions({ auctionId, title, next }: { auctionId: string; title: string; next: { amount: number; username: string | null } | null }) {
  const { run, pending, error, status } = useRun();
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {next ? (
          <ConfirmButton
            label={`Offer to the next bidder (${formatEur(next.amount)})`}
            ariaLabel={`Offer to the next bidder (${formatEur(next.amount)}): ${title}`}
            variant="default"
            size="sm"
            disabled={pending}
            title={`Offer the car to ${next.username ?? "the next bidder"} for ${formatEur(next.amount)}?`}
            description={
              <p>
                That&apos;s their highest bid. They have 48 hours to accept and pay the buyer&apos;s premium. If they don&apos;t,
                you can relist the car.
              </p>
            }
            confirmLabel="Send the offer"
            onConfirm={() => run(() => offerToNextBidderAction({ auctionId }))}
          >
            {error}
          </ConfirmButton>
        ) : (
          <p className="text-sm text-mute">There&apos;s no other bidder to offer the car to.</p>
        )}
        <ConfirmButton
          label="Relist this car"
          ariaLabel={`Relist this car: ${title}`}
          size="sm"
          disabled={pending}
          title="Relist this car?"
          description={
            <p>
              A new listing is made with the same details and photos. Biddr&apos;s team reviews it and schedules a new auction,
              as with any listing.
            </p>
          }
          confirmLabel="Relist"
          onConfirm={() => run(() => relistCarAction({ auctionId }))}
        >
          {error}
        </ConfirmButton>
      </div>
      {status}
    </div>
  );
}

/** The car was paid for and handed over. */
export function CompleteSaleButton({ paymentId, title }: { paymentId: string; title: string }) {
  const { run, pending, error, status } = useRun();
  return (
    <div className="space-y-2">
      <ConfirmButton
        label="Sale completed"
        ariaLabel={`Sale completed: ${title}`}
        size="sm"
        disabled={pending}
        title="Has the buyer paid for the car and taken it over?"
        description={<p>Mark the sale completed once you&apos;ve received the payment for the car and handed it over.</p>}
        confirmLabel="Yes, sale completed"
        onConfirm={() => run(() => completeSaleAction({ paymentId }))}
      >
        {error}
      </ConfirmButton>
      {status}
    </div>
  );
}

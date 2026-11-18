"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmButton } from "@/app/admin/auctions/[id]/confirm-button";
import type { AfterSaleResult } from "@/lib/after-sale";
import { acceptOfferAction, declineOfferAction } from "./offer-actions";

/** Accept (binding; the premium is paid right after) or decline a second-chance offer. */
export function OfferButtons({ offerId, title, premium }: { offerId: string; title: string; premium: string }) {
  const router = useRouter();
  const [result, setResult] = useState<AfterSaleResult | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (fn: typeof acceptOfferAction) => {
    setPending(true);
    const r = await fn({ offerId });
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
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          label="Accept and pay"
          ariaLabel={`Accept and pay: ${title}`}
          variant="default"
          disabled={pending}
          title={`Buy ${title}?`}
          description={
            <p>
              Accepting is binding. Next you pay the buyer&apos;s premium of {premium} on this page; then you get the seller&apos;s
              contact details and pay them for the car directly.
            </p>
          }
          confirmLabel="Accept"
          onConfirm={() => run(acceptOfferAction)}
        >
          {error}
        </ConfirmButton>
        <ConfirmButton
          label="Decline"
          ariaLabel={`Decline: ${title}`}
          disabled={pending}
          title={`Decline the offer for ${title}?`}
          description={<p>The seller is told, and the offer ends. You can&apos;t accept it later.</p>}
          confirmLabel="Decline offer"
          onConfirm={() => run(declineOfferAction)}
        >
          {error}
        </ConfirmButton>
      </div>
      <p role="status" className="text-sm">
        {result?.ok ? result.message : ""}
      </p>
    </div>
  );
}

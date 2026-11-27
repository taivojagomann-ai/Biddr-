"use client";
import { useState } from "react";
import { ActionMessage, FieldNote, useAdminAction } from "@/app/admin/auctions/[id]/action-feedback";
import { Label } from "@/app/admin/auctions/[id]/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { refundPremiumSeat, savePremiumSettings, setPremiumSeat } from "../actions";

export function PremiumSettingsForm({ initial }: { initial: { priceEur: number; limit: number } }) {
  const [price, setPrice] = useState(String(initial.priceEur));
  const [limit, setLimit] = useState(String(initial.limit));
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  return (
    <form
      className="mt-3 grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(savePremiumSettings, { priceEur: price, limit });
      }}
    >
      <div>
        <Label htmlFor="seat-price">Price per auction (€, VAT included)</Label>
        <Input id="seat-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={fe.priceEur ? true : undefined} />
        <FieldNote error={fe.priceEur} />
      </div>
      <div>
        <Label htmlFor="seat-limit">Paid seats at the same time</Label>
        <Input id="seat-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={fe.limit ? true : undefined} />
        <FieldNote error={fe.limit} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <ActionMessage result={result} />
      </div>
    </form>
  );
}

/** Refund (and remove), or remove (which refunds a paid seat too), with a reason; both logged. */
export function PremiumSeatRowActions({ purchaseId, auctionId, title, live }: { purchaseId: string; auctionId: string; title: string; live: boolean }) {
  const [reason, setReason] = useState("");
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  const id = `reason-${purchaseId}`;
  return (
    <div className="space-y-2">
      <div className="max-w-md">
        <Label htmlFor={id}>Reason (kept in the admin log)</Label>
        <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={fe.reason ? true : undefined} />
        <FieldNote error={fe.reason} hint={live ? "Live: there's no automatic refund; refund here only if you decide to." : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={pending} aria-label={`Refund the premium seat for ${title}`} onClick={() => void run(refundPremiumSeat, { purchaseId, reason })}>
          Refund
        </Button>
        <Button type="button" variant="outline" disabled={pending} aria-label={`Remove seat for ${title}`} onClick={() => void run(setPremiumSeat, { auctionId, on: false, reason })}>
          Remove seat
        </Button>
        <ActionMessage result={result} />
      </div>
    </div>
  );
}

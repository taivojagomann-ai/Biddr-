"use client";
import { useState } from "react";
import { ActionMessage, FieldNote, useAdminAction } from "@/app/admin/auctions/[id]/action-feedback";
import { Label } from "@/app/admin/auctions/[id]/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMyPrice } from "./actions";

/** The seller's starting bid and requested reserve (empty for no reserve), as in the sell form. */
export function PriceForm({ auctionId, initial }: { auctionId: string; initial: { startingBid: number; reserve: number | null } }) {
  const [startingBid, setStartingBid] = useState(String(initial.startingBid));
  const [reserve, setReserve] = useState(initial.reserve === null ? "" : String(initial.reserve));
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(updateMyPrice, { auctionId, startingBid, reserve });
      }}
    >
      <div>
        <Label htmlFor="edit-startingBid">Starting bid (€)</Label>
        <Input id="edit-startingBid" inputMode="numeric" value={startingBid} onChange={(e) => setStartingBid(e.target.value)} aria-invalid={fe.startingBid ? true : undefined} />
        <FieldNote error={fe.startingBid} />
      </div>
      <div>
        <Label htmlFor="edit-reserve" optional>
          Reserve price (€)
        </Label>
        <Input id="edit-reserve" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} aria-invalid={fe.reserve ? true : undefined} aria-describedby="edit-reserve-hint" />
        <div id="edit-reserve-hint">
          <FieldNote error={fe.reserve} hint="Leave empty for no reserve. Bidders never see it, only whether it has been met." />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <ActionMessage result={result} />
      </div>
    </form>
  );
}

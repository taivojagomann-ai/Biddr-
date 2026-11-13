"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_MIN_INCREMENT } from "@/lib/admin-schemas";
import { formatEur } from "@/lib/format";
import { savePricing } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

export function PricingForm({
  auctionId,
  mode,
  initial,
  requestedReserve,
}: {
  auctionId: string;
  /** "full" before bidding opens, "reserve-only" while live, "closed" afterwards. */
  mode: "full" | "reserve-only" | "closed";
  initial: { startingBid: number; minIncrement: number | null; reserve: number | null; hasReserve: boolean };
  requestedReserve: number | null;
}) {
  const startingReserve = initial.reserve ?? requestedReserve;
  const [startingBid, setStartingBid] = useState(String(initial.startingBid));
  const [minIncrement, setMinIncrement] = useState(String(initial.minIncrement ?? DEFAULT_MIN_INCREMENT));
  const [noReserve, setNoReserve] = useState(startingReserve === null);
  const [reserve, setReserve] = useState(startingReserve === null ? "" : String(startingReserve));
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  const locked = mode !== "full";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(savePricing, { auctionId, startingBid, minIncrement, noReserve, reserve });
      }}
    >
      <fieldset disabled={mode === "closed"} className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="price-start">Starting bid (€)</Label>
          <Input id="price-start" inputMode="numeric" value={startingBid} onChange={(e) => setStartingBid(e.target.value)} disabled={locked} />
          <FieldNote error={fe.startingBid} />
        </div>
        <div>
          <Label htmlFor="price-inc">Minimum bid increment (€)</Label>
          <Input id="price-inc" inputMode="numeric" value={minIncrement} onChange={(e) => setMinIncrement(e.target.value)} disabled={locked} />
          <FieldNote error={fe.minIncrement} hint={`Usually ${formatEur(DEFAULT_MIN_INCREMENT)}.`} />
        </div>
        <div>
          <Label htmlFor="price-reserve">Reserve price (€)</Label>
          <Input
            id="price-reserve"
            inputMode="numeric"
            value={noReserve ? "" : reserve}
            placeholder={noReserve ? "No reserve" : undefined}
            onChange={(e) => setReserve(e.target.value)}
            disabled={noReserve}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noReserve} onChange={(e) => setNoReserve(e.target.checked)} className="size-4 accent-[#FF5500]" />
            No reserve
          </label>
          <FieldNote
            error={fe.reserve}
            hint={
              requestedReserve !== null
                ? `The seller asked for ${formatEur(requestedReserve)}.`
                : "The seller didn't ask for a reserve."
            }
          />
        </div>
      </fieldset>
      {mode === "reserve-only" ? (
        <p className="text-xs text-mute">Bidding is open: the starting bid and increment are fixed, and the reserve can only go down or be removed.</p>
      ) : null}
      {mode === "closed" ? <p className="text-xs text-mute">This auction is closed, so pricing can&apos;t change.</p> : null}
      {mode !== "closed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save pricing"}
          </Button>
          <ActionMessage result={result} />
        </div>
      ) : null}
    </form>
  );
}

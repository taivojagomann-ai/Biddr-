"use client";
import { useState } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPremiumSeat } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

/** Premium seat on/off with a reason (logged). A seat lasts until the auction ends; the car shows "Featured". */
export function PremiumSeatForm({
  auctionId,
  until,
  source,
  canSet,
}: {
  auctionId: string;
  until: string | null;
  source: string | null;
  canSet: boolean;
}) {
  const active = Boolean(until && Date.parse(until) > Date.now());
  const [reason, setReason] = useState("");
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(setPremiumSeat, { auctionId, on: !active, reason });
      }}
    >
      <p data-premium-seat={active ? "on" : "off"} className="text-sm">
        {active ? (
          <>
            <span className="font-semibold">On</span> ({source === "paid" ? "paid by the seller" : "set by an admin"}) until{" "}
            <LocalDateTime iso={until} />. The car is in the featured carousel, labelled &quot;Featured&quot;.
          </>
        ) : (
          <>
            <span className="font-semibold">Off</span>
            {canSet ? "." : ". Only a scheduled or live auction can have one."}
          </>
        )}
      </p>
      {active || canSet ? (
        <>
          <div>
            <Label htmlFor="premium-reason">Reason (kept in the admin log)</Label>
            <Input id="premium-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={fe.reason ? true : undefined} />
            <FieldNote error={fe.reason} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant={active ? "outline" : "default"} disabled={pending}>
              {pending ? "Saving…" : active ? "Remove premium seat" : "Give a premium seat"}
            </Button>
            <ActionMessage result={result} />
          </div>
        </>
      ) : null}
    </form>
  );
}

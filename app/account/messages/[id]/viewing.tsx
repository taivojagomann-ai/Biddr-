"use client";
import { useId, useState } from "react";
import { CalendarCheck, CalendarClock, CalendarX, Loader2, Phone } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { EMPTY_SLOT, SlotFields, slotsToIso, type Slot } from "@/components/messages/slot-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useTimeZone } from "@/hooks/use-time-zone";
import { messageError, type SharedPhone, type ViewingRequestRow } from "@/lib/messages";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Role = "buyer" | "seller";

/**
 * A viewing request in the conversation. The other party confirms one of the times or
 * declines; the proposer can cancel while it waits; either can cancel a confirmed one.
 */
export function ViewingCard({
  request,
  viewerId,
  viewerRole,
  writable,
  onChanged,
  onProposeOther,
}: {
  request: ViewingRequestRow;
  viewerId: string;
  viewerRole: Role;
  writable: boolean;
  onChanged: (row: ViewingRequestRow) => void;
  onProposeOther: () => void;
}) {
  const mine = request.created_by === viewerId;
  const other = viewerRole === "buyer" ? "the seller" : "the buyer";
  const [choice, setChoice] = useState<string | null>(request.proposed_slots.length === 1 ? request.proposed_slots[0]! : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function respond(action: "confirm" | "decline" | "cancel") {
    if (action === "confirm" && !choice) {
      setError("Choose one of the times first.");
      return;
    }
    setBusy(action);
    setError(null);
    const { data, error: rpcError } = await getBrowserSupabase()
      .rpc("respond_viewing", { p_request: request.id, p_action: action, p_slot: action === "confirm" ? choice : null })
      .single<ViewingRequestRow>();
    setBusy(null);
    if (rpcError || !data) {
      setError(messageError(rpcError?.message, "That didn't work. Try again."));
      return;
    }
    onChanged(data);
  }

  const confirmed = request.status === "confirmed";
  const closed = request.status === "declined" || request.status === "cancelled";
  const Icon = confirmed ? CalendarCheck : closed ? CalendarX : CalendarClock;
  const heading = confirmed
    ? "Viewing confirmed"
    : request.status === "declined"
      ? "Viewing times declined"
      : request.status === "cancelled"
        ? "Viewing cancelled"
        : mine
          ? `You proposed ${request.proposed_slots.length === 1 ? "a time" : "times"} for a viewing`
          : `${other === "the seller" ? "The seller" : "The buyer"} proposed ${request.proposed_slots.length === 1 ? "a time" : "times"} for a viewing`;

  return (
    <article
      aria-labelledby={`${id}-h`}
      data-viewing={request.status}
      className={cn(
        "w-full rounded-lg border p-3 text-sm",
        confirmed ? "border-verified/70 bg-verified/10" : closed ? "border-line bg-asphalt/40 text-mute" : "border-signal/50 bg-panel",
      )}
    >
      <h3 id={`${id}-h`} className="flex items-center gap-2 font-semibold text-chalk">
        <Icon aria-hidden className={cn("size-5 shrink-0", confirmed ? "text-verified" : closed ? "text-mute" : "text-signal")} />
        {heading}
      </h3>

      {confirmed && request.confirmed_slot ? (
        <p className="mt-2 text-base font-bold text-chalk">
          <LocalDateTime iso={request.confirmed_slot} />
        </p>
      ) : request.status === "proposed" && !mine && writable ? (
        <fieldset className="mt-2">
          <legend className="sr-only">Choose a time</legend>
          <ul className="space-y-1">
            {request.proposed_slots.map((s) => (
              <li key={s}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-asphalt/60">
                  <input
                    type="radio"
                    name={`${id}-slot`}
                    value={s}
                    checked={choice === s}
                    onChange={() => setChoice(s)}
                    className="size-4 shrink-0 accent-[#FF5500]"
                  />
                  <LocalDateTime iso={s} />
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <ul className={cn("mt-2 space-y-1", closed && "line-through decoration-mute/60")}>
          {request.proposed_slots.map((s) => (
            <li key={s}>
              <LocalDateTime iso={s} />
            </li>
          ))}
        </ul>
      )}

      {writable && request.status === "proposed" && !mine ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" className="min-h-11" disabled={busy !== null} onClick={() => void respond("confirm")}>
            {busy === "confirm" ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Confirm this time
          </Button>
          <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy !== null} onClick={onProposeOther}>
            Propose other times
          </Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy !== null} onClick={() => void respond("decline")}>
            {busy === "decline" ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Decline
          </Button>
        </div>
      ) : null}
      {writable && request.status === "proposed" && mine ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-mute">Waiting for {other} to answer.</p>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy !== null} onClick={() => void respond("cancel")}>
            Cancel request
          </Button>
        </div>
      ) : null}
      {writable && confirmed ? (
        <div className="mt-3">
          <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy !== null} onClick={() => void respond("cancel")}>
            {busy === "cancel" ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Cancel viewing
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-signal">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/** "Propose viewing times": 1 to 3 times; earlier times still waiting for an answer are replaced. */
export function ProposeTimes({
  conversationId,
  onProposed,
  onCancel,
}: {
  conversationId: string;
  onProposed: (row: ViewingRequestRow) => void;
  onCancel: () => void;
}) {
  const tz = useTimeZone();
  const [slots, setSlots] = useState<Slot[]>([EMPTY_SLOT]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = slotsToIso(slots, tz);
    if ("error" in r) return setError(r.error);
    if (!r.iso.length) return setError("Fill in at least one day and time.");
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await getBrowserSupabase()
      .rpc("propose_viewing", { p_conversation: conversationId, p_slots: r.iso })
      .single<ViewingRequestRow>();
    setBusy(false);
    if (rpcError || !data) return setError(messageError(rpcError?.message, "The times weren't sent. Try again."));
    onProposed(data);
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3 rounded-lg border border-line bg-panel p-3">
      <SlotFields slots={slots} onChange={setSlots} legend="Propose viewing times" describedBy={error ? `${id}-err` : undefined} />
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-signal">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="min-h-11">
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Send times
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * After a viewing is confirmed, each party can share their own phone number with the
 * other, deliberately (a confirmation first; once shared it can't be hidden).
 */
export function PhonePanel({
  conversationId,
  viewerId,
  viewerRole,
  phones,
  writable,
  onShared,
}: {
  conversationId: string;
  viewerId: string;
  viewerRole: Role;
  phones: SharedPhone[];
  writable: boolean;
  onShared: () => void;
}) {
  const otherRole = viewerRole === "buyer" ? "seller" : "buyer";
  const mine = phones.find((p) => p.user_id === viewerId);
  const theirs = phones.find((p) => p.user_id !== viewerId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getBrowserSupabase().rpc("share_phone", { p_conversation: conversationId });
    setBusy(false);
    if (rpcError) {
      setOpen(false);
      setError(messageError(rpcError.message, "Your number wasn't shared. Try again."));
      return;
    }
    setOpen(false);
    onShared();
  }

  return (
    <section aria-labelledby="phones-heading" className="rounded-lg border border-line bg-panel p-3 text-sm">
      <h2 id="phones-heading" className="flex items-center gap-2 font-semibold">
        <Phone aria-hidden className="size-4 text-mute" />
        Phone numbers for the viewing
      </h2>
      {theirs ? (
        <p className="mt-2">
          The {otherRole}&apos;s phone:{" "}
          <a href={`tel:${theirs.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-chalk underline underline-offset-4 hover:text-signal">
            {theirs.phone}
          </a>
        </p>
      ) : (
        <p className="mt-2 text-mute">The {otherRole} hasn&apos;t shared a phone number.</p>
      )}
      {mine ? (
        <p className="mt-2 text-mute">
          You shared your phone number <span className="text-chalk">{mine.phone}</span> for this viewing.
        </p>
      ) : writable ? (
        <>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => setOpen(true)}>
            Share my phone number for this viewing
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent aria-describedby="share-phone-desc">
              <DialogTitle>Share your phone number?</DialogTitle>
              <DialogDescription id="share-phone-desc">
                The {otherRole} will see the phone number from your profile, to reach you about the viewing. Once shared, it
                can&apos;t be hidden again.
              </DialogDescription>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="outline" className="min-h-11">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="button" className="min-h-11" disabled={busy} onClick={() => void share()}>
                  {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                  Share my phone number
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-signal">
          {error}
        </p>
      ) : null}
    </section>
  );
}

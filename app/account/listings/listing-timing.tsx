"use client";
import { useEffect, useState } from "react";
import type { RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { Clock } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { formatTimeLeft, formatTimeLeftSpoken } from "@/lib/format";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Auction, AuctionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Timing = { status: AuctionStatus; starts_at: string | null; ends_at: string | null };

const ENDED: AuctionStatus[] = ["sold", "ended", "reserve_not_met"];

/**
 * A listing's timing on My listings: live, "Ends in 2d 4h" (orange under an hour) with the
 * exact end below; scheduled, "Starts in …" and the end; finished, "Ended <date>". Ticks
 * once a minute on the server-corrected clock; a late bid that extends the auction (or the
 * auction going live or closing) arrives in realtime. Nothing for listings in review,
 * not accepted or withdrawn.
 */
export function ListingTiming({ id, initial, initialNow }: { id: string; initial: Timing; initialNow: number }) {
  const [t, setT] = useState(initial);
  const now = useMinuteNow(initialNow);
  const watching = t.status === "live" || t.status === "upcoming";

  useEffect(() => setT(initial), [initial]);
  useEffect(() => {
    if (!watching) return;
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`my-listing:${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions", filter: `id=eq.${id}` }, (payload: RealtimePostgresUpdatePayload<Auction>) => {
        const n = payload.new;
        setT({ status: n.status, starts_at: n.starts_at, ends_at: n.ends_at });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, watching]);

  if (ENDED.includes(t.status) && t.ends_at) {
    return (
      <p data-timing="ended" className="mt-1 text-xs text-mute">
        Ended <LocalDateTime iso={t.ends_at} />
      </p>
    );
  }
  if (!watching) return null;

  const target = t.status === "live" ? t.ends_at : t.starts_at;
  if (!target) return null;
  const left = Date.parse(target) - now;
  const underHour = t.status === "live" && left <= 60 * 60_000;
  const label = t.status === "live" ? "Ends in" : "Starts in";
  return (
    <div data-timing={t.status} className="mt-1.5 space-y-0.5">
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
        <span
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-sm border border-line bg-asphalt px-1.5 py-0.5 text-sm font-semibold leading-tight",
            underHour && "text-signal",
          )}
        >
          <Clock aria-hidden className="size-3.5 shrink-0" />
          {left > 0 ? (
            <>
              <span aria-hidden>{label}</span>
              <time dateTime={target} aria-hidden data-time-left className="tabular">
                {formatTimeLeft(left)}
              </time>
              <span className="sr-only">
                {t.status === "live" ? "Time left" : "Starts in"}: {formatTimeLeftSpoken(left)}
                {underHour ? ", less than an hour" : ""}
              </span>
            </>
          ) : (
            <span>{t.status === "live" ? "Closing…" : "Opening…"}</span>
          )}
        </span>
      </p>
      {t.ends_at ? (
        <p className="text-xs text-mute">
          {t.status === "live" ? "" : "Ends "}
          <LocalDateTime iso={t.ends_at} />
        </p>
      ) : null}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CARVERTICAL_HOME, HISTORY_TEXT, OLD_CAR_YEAR } from "@/lib/history-report";
import type { Auction } from "@/lib/types";

const linkClass = "inline-flex min-h-11 items-center gap-1.5 font-semibold underline underline-offset-4 hover:text-signal";

/**
 * "Vehicle history report" (DECISIONS.md point 11). With an accepted carVertical
 * report: Biddr's summary and, only if the seller allowed sharing, a link to the
 * report. Without one: a plain notice, Copy VIN and a link to check the car on
 * carVertical (carVertical documents no URL that pre-fills a VIN, so the link
 * goes to its home page and the buyer pastes the VIN).
 */
export function HistoryReportSection({
  auction,
}: {
  auction: Pick<Auction, "vin" | "year" | "history_report_verified" | "history_summary" | "history_report_public_link">;
}) {
  const verified = auction.history_report_verified;
  return (
    <section aria-labelledby="vehicle-history-heading" className="rounded-lg border border-line bg-panel p-4 sm:p-5">
      <h2 id="vehicle-history-heading" className="text-lg font-bold">
        {HISTORY_TEXT.heading}
      </h2>
      {verified ? (
        <>
          <p className="mt-2 text-sm">{HISTORY_TEXT.provided}</p>
          {auction.history_summary.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {auction.history_summary.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
          {auction.history_report_public_link ? (
            <p className="mt-3 text-sm">
              <a href={auction.history_report_public_link} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {HISTORY_TEXT.viewFull}
                <ExternalLink aria-hidden className="size-4" />
                <span className="sr-only"> (carVertical, opens in a new tab)</span>
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm">{HISTORY_TEXT.none}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <CopyVin vin={auction.vin} />
            <a href={CARVERTICAL_HOME} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {HISTORY_TEXT.checkLink}
              <ExternalLink aria-hidden className="size-4" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </>
      )}
      {auction.year < OLD_CAR_YEAR ? <p className="mt-3 text-sm text-mute">{HISTORY_TEXT.oldCar}</p> : null}
    </section>
  );
}

function CopyVin({ vin }: { vin: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(vin);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 4000);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-describedby="vehicle-history-vin">
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {HISTORY_TEXT.copyVin}
      </Button>
      <span id="vehicle-history-vin" className="font-mono text-xs tracking-wide text-mute">
        <span className="sr-only">VIN </span>
        {vin}
      </span>
      {/* Polite, so it doesn't interrupt. */}
      <span role="status" className={state === "idle" ? "sr-only" : "text-xs font-semibold"}>
        {state === "copied" ? HISTORY_TEXT.copied : state === "failed" ? "Couldn't copy. Select the VIN and copy it yourself." : ""}
      </span>
    </span>
  );
}

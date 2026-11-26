"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { submitForChecking } from "./actions";

const FAILED = "We couldn't run the checks just now. Your files are saved: try again in a few minutes.";

/**
 * "Submit for checking" with the progress text. While the checks run, "Checking…" shows in
 * the Check results slot at the top of the page (`#check-results-slot`), so the result is
 * in view on phones without scrolling.
 */
export function SubmitForChecking({ auctionId, ready, progress }: { auctionId: string; ready: boolean; progress: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("check-results-slot")), []);

  async function submit() {
    setBusy(true);
    setError(null);
    slot?.scrollIntoView({ block: "start" });
    try {
      const r = await submitForChecking({ auctionId });
      if (!r.ok) setError(r.error);
      router.refresh();
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p id="required-progress" className="text-sm font-semibold">
        {progress}
      </p>
      <Button type="button" size="lg" className="min-h-12 w-full sm:w-auto" disabled={!ready || busy} aria-describedby="required-progress" onClick={() => void submit()}>
        Submit for checking
      </Button>
      {!ready ? <p className="text-sm text-mute">Add every required item to submit.</p> : null}
      {error ? (
        <p role="alert" className="flex gap-2 text-sm text-status-danger">
          <StatusIcon kind="failed" className="mt-0.5 size-4" />
          {error}
        </p>
      ) : null}
      {busy && slot
        ? createPortal(
            <section aria-labelledby="checking-now" className="rounded-lg border border-line bg-panel p-4">
              <h2 id="checking-now" className="text-lg font-bold">
                Check results
              </h2>
              <p role="status" className="mt-3 flex items-start gap-3 rounded-md border border-line bg-asphalt/40 p-3">
                <StatusIcon kind="waiting" animate className="mt-0.5 size-5" />
                <span>
                  <span className="block font-semibold">Checking…</span>
                  <span className="block text-sm text-mute">We&apos;ll notify you when it&apos;s done. This usually takes up to a minute.</span>
                </span>
              </p>
            </section>,
            slot,
          )
        : null}
    </div>
  );
}

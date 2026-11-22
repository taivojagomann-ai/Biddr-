"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runChecks } from "./actions";

const FAILED = "We couldn't run the checks just now. Your files are saved: try again in a few minutes.";

/**
 * Runs the checks again on the saved files, after an error or a timeout. It stays on the
 * page after a successful run (`needed` false, no button), so the result stays readable.
 */
export function RunChecksButton({ auctionId, needed }: { auctionId: string; needed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult({ ok: true, text: "Checking the photos and documents… This takes up to a minute." });
    try {
      const r = await runChecks({ auctionId });
      setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    } catch {
      setResult({ ok: false, text: FAILED });
    } finally {
      setBusy(false);
    }
  }

  if (!needed && !busy && !result) return null;
  return (
    <div className="mt-3 space-y-2">
      {needed || busy ? (
        <Button type="button" className="min-h-12 w-full sm:w-auto" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
          Run the checks
        </Button>
      ) : null}
      <p role="status" aria-live="polite" className={result && !result.ok ? "text-sm text-signal" : "text-sm text-mute"}>
        {result?.text ?? ""}
      </p>
    </div>
  );
}

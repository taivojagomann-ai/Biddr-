"use client";
import { useCallback, useId, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DealerReportUpload } from "@/app/sell/dealer-report-upload";
import type { ReportFile } from "@/lib/report-paths";
import { submitNewHistoryReport, updateDamageSummary } from "./actions";

/**
 * The seller's carVertical history report wasn't accepted. While the listing is
 * in review they can upload another report or correct the damage description;
 * either sends the report back to Biddr's team.
 */
export function HistoryRejectedPanel({
  auctionId,
  userId,
  title,
  reason,
  damageSummary,
  resubmitted,
}: {
  auctionId: string;
  userId: string;
  title: string;
  reason: string | null;
  damageSummary: string | null;
  /** The seller already responded; Biddr's team hasn't reviewed it again yet. */
  resubmitted: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState<"report" | "description" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const finish = (message: string) => {
    setDone(message);
    setOpen(null);
  };
  if (done || resubmitted) {
    return (
      <p role="status" className="text-sm font-semibold text-verified">
        {done ?? "Your vehicle history report is waiting for Biddr's team to check it again."}
      </p>
    );
  }
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-lg border border-signal/60 bg-panel p-4">
      <h2 id={`${id}-heading`} className="flex items-center gap-2 text-sm font-bold">
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-status-warning" />
        Vehicle history report not accepted
      </h2>
      <p className="mt-2 text-sm">
        <span className="text-mute">Reason: </span>
        {reason ?? "The report couldn't be checked."}
      </p>
      <p className="mt-1 text-sm text-mute">
        Upload another carVertical report, or correct the damage description so it matches the report. Your listing stays in
        review either way.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          aria-expanded={open === "report"}
          aria-controls={`${id}-report`}
          onClick={() => setOpen((o) => (o === "report" ? null : "report"))}
        >
          Upload another report<span className="sr-only">: {title}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={open === "description"}
          aria-controls={`${id}-description`}
          onClick={() => setOpen((o) => (o === "description" ? null : "description"))}
        >
          Correct the description<span className="sr-only">: {title}</span>
        </Button>
      </div>
      <div id={`${id}-report`} hidden={open !== "report"} className="mt-4">
        {open === "report" ? <NewHistoryReportForm auctionId={auctionId} userId={userId} idBase={`${id}-r`} onDone={finish} /> : null}
      </div>
      <div id={`${id}-description`} hidden={open !== "description"} className="mt-4">
        {open === "description" ? (
          <DamageSummaryForm auctionId={auctionId} initial={damageSummary ?? ""} idBase={`${id}-d`} onDone={finish} />
        ) : null}
      </div>
    </section>
  );
}

function NewHistoryReportForm({
  auctionId,
  userId,
  idBase,
  onDone,
}: {
  auctionId: string;
  userId: string;
  idBase: string;
  onDone: (message: string) => void;
}) {
  const [files, setFiles] = useState<ReportFile[]>([]);
  const [link, setLink] = useState("");
  const [share, setShare] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploading = useRef(false);
  const onBusyChange = useCallback((b: boolean) => {
    uploading.current = b;
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (uploading.current) {
      setFormError("Wait for the files to finish uploading.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await submitNewHistoryReport({ auctionId, historyFiles: files, historyLink: link, historyShareAllowed: share });
      if (res.ok) return onDone(res.message);
      setErrors(res.fieldErrors ?? {});
      setFormError(res.fieldErrors && Object.keys(res.fieldErrors).length ? null : res.error);
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="New vehicle history report">
      <DealerReportUpload
        userId={userId}
        draftId={auctionId}
        files={files}
        onChange={setFiles}
        onBusyChange={onBusyChange}
        error={errors.historyFiles}
        idBase={`${idBase}-files`}
        title="carVertical report"
        hint="The report as a PDF, or photos of every page: up to 10 files, 20 MB each. You can also (or instead) paste the report's share link."
        listLabel="History report files"
      />
      <div className="space-y-1.5">
        <label htmlFor={`${idBase}-link`} className="block text-sm font-semibold">
          carVertical share link <span className="font-normal text-mute">(optional)</span>
        </label>
        <Input
          id={`${idBase}-link`}
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://www.carvertical.com/…"
          aria-invalid={errors.historyLink ? true : undefined}
          aria-describedby={errors.historyLink ? `${idBase}-link-error` : undefined}
        />
        {errors.historyLink ? (
          <p id={`${idBase}-link-error`} className="text-xs font-medium text-signal">
            {errors.historyLink}
          </p>
        ) : null}
      </div>
      <div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            aria-describedby={`${idBase}-share-hint`}
            className="mt-0.5 size-4 shrink-0 accent-[#FF5500]"
          />
          <span className="font-semibold">I&apos;m allowed to share this report with buyers</span>
        </label>
        <p id={`${idBase}-share-hint`} className="ml-7 text-xs text-mute">
          If you don&apos;t tick this, buyers will only see our summary, not the report itself.
        </p>
      </div>
      {formError ? (
        <p role="alert" className="text-sm font-medium text-signal">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send the new report"}
      </Button>
    </form>
  );
}

function DamageSummaryForm({
  auctionId,
  initial,
  idBase,
  onDone,
}: {
  auctionId: string;
  initial: string;
  idBase: string;
  onDone: (message: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await updateDamageSummary({ auctionId, damageSummary: text });
      if (res.ok) return onDone(res.message);
      setError(res.fieldErrors?.damageSummary ?? res.error);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Correct the damage description">
      <div className="space-y-1.5">
        <label htmlFor={`${idBase}-summary`} className="block text-sm font-semibold">
          Damage and repair summary
        </label>
        <Textarea
          id={`${idBase}-summary`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={4000}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${idBase}-summary-hint`, error ? `${idBase}-summary-error` : null].filter(Boolean).join(" ")}
          className="p-3"
        />
        <p id={`${idBase}-summary-hint`} className="text-xs text-mute">
          Describe any damage the report shows and how it was repaired. At least 40 characters.
        </p>
        {error ? (
          <p id={`${idBase}-summary-error`} role="alert" className="text-xs font-medium text-signal">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save and send for review"}
      </Button>
    </form>
  );
}

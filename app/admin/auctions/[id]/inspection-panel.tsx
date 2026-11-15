"use client";
import { useRef, useState } from "react";
import { AlertTriangle, ExternalLink, FileText, Loader2, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  INSPECTION_BUCKET,
  INSPECTION_HIGHLIGHTS_MAX,
  INSPECTION_HIGHLIGHTS_MIN,
  MAX_REPORT_BYTES,
  REPORT_CHECKS,
  type AdminResult,
  type ReportCheckKey,
} from "@/lib/admin-schemas";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { SellerInspectionDecision } from "@/lib/types";
import { useTimeZone } from "@/hooks/use-time-zone";
import { formatDateTime } from "@/lib/zoned-time";
import { acceptInspectionReport, rejectInspectionReport, saveInspectionReport } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

export interface DealerReportView {
  /** true: the seller uploaded a report; false: listed without one; null: submitted before dealer reports. */
  provided: boolean | null;
  dealer: { name: string; city: string; country: string; date: string; mileageKm: number | null } | null;
  files: { index: number; label: string }[];
  review: { status: "pending" | "accepted" | "rejected" | null; note: string | null; reviewedAt: string | null };
  /** Plain-language warnings worked out on the server (mileage, report age). */
  warnings: string[];
  /** The seller's choice after a rejected report (0016). */
  decision: { required: boolean; deadline: string | null; choice: SellerInspectionDecision | null; at: string | null };
}



const STATUS_TEXT = {
  pending: "Waiting for your review",
  accepted: "Accepted: the listing shows the Dealer inspected badge",
  rejected: "Rejected",
} as const;

export function InspectionPanel({
  auctionId,
  reviewable,
  report,
  listingMileage,
  initialHighlights,
  reportUrl,
  sellerIsDealer = false,
  initialInspectedBySeller = false,
}: {
  /** The seller is a dealer: the admin can mark the report as the seller's own inspection. */
  sellerIsDealer?: boolean;
  initialInspectedBySeller?: boolean;
  auctionId: string;
  /** Draft or scheduled: the decision can still change. */
  reviewable: boolean;
  report: DealerReportView;
  listingMileage: string;
  initialHighlights: string[];
  reportUrl: string | null;
}) {
  const tz = useTimeZone();
  const dateTime = (iso: string) => formatDateTime(iso, tz);
  if (report.provided !== true || !report.dealer) {
    return (
      <p className="text-sm text-mute">
        {report.provided === false
          ? "The seller listed without a dealer inspection. The listing shows “Not inspected”."
          : "This listing was submitted before dealer inspection reports, so there's no report to review."}
      </p>
    );
  }
  const d = report.dealer;
  const status = report.review.status;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="text-sm">
          <span className="font-semibold">Review: </span>
          {status ? STATUS_TEXT[status] : "Not reviewed"}
          {status === "rejected" && report.review.note ? <span className="text-mute"> ({report.review.note})</span> : null}
          {report.review.reviewedAt ? <span className="text-mute"> · {dateTime(report.review.reviewedAt)}</span> : null}
        </p>
        {report.decision.required ? (
          <p className="text-sm">
            <span className="font-semibold">Seller&apos;s decision: </span>
            waiting for them to choose a new report or to list without an inspection
            {report.decision.deadline ? <span className="text-mute"> · deadline {dateTime(report.decision.deadline)}</span> : null}
          </p>
        ) : report.decision.choice ? (
          <p className="text-sm">
            <span className="font-semibold">Seller&apos;s decision: </span>
            {report.decision.choice === "new_report"
              ? "uploaded a new report (shown here, waiting for your review)"
              : "list without an inspection (the listing can be approved without a badge)"}
            {report.decision.at ? <span className="text-mute"> · {dateTime(report.decision.at)}</span> : null}
          </p>
        ) : null}

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-mute">Dealer</dt>
            <dd className="font-semibold">{[d.name, d.city, d.country].filter(Boolean).join(", ")}</dd>
          </div>
          <div>
            <dt className="text-mute">Inspection date</dt>
            <dd className="font-semibold">
              {new Date(`${d.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
          <div>
            <dt className="text-mute">Mileage on the report</dt>
            <dd className="font-semibold">{d.mileageKm !== null ? `${d.mileageKm.toLocaleString("en-IE")} km` : "Not given"}</dd>
          </div>
          <div>
            <dt className="text-mute">Mileage in the listing</dt>
            <dd className="font-semibold">{listingMileage}</dd>
          </div>
        </dl>

        {report.warnings.length ? (
          <ul className="space-y-2">
            {report.warnings.map((w) => (
              <li key={w} className="flex gap-2 rounded-md border border-signal/60 px-3 py-2 text-sm">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
                <span>
                  <span className="font-semibold">Check: </span>
                  {w}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div>
          <h3 className="text-sm font-semibold">Report files</h3>
          <p className="text-xs text-mute">Private. Each link opens a copy that works for one minute.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {report.files.map((f) => (
              <li key={f.index}>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/admin/inspection-file?auction=${auctionId}&file=${f.index}`} target="_blank" rel="noreferrer">
                    <FileText aria-hidden />
                    {f.label}
                    <ExternalLink aria-hidden className="size-3.5" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {reviewable && status === "rejected" ? (
        <p className="text-sm text-mute">
          The report was rejected. A new report from the seller will appear here for the same checks.
        </p>
      ) : reviewable ? (
        <>
          <AcceptForm
            auctionId={auctionId}
            accepted={status === "accepted"}
            initialHighlights={initialHighlights}
            sellerIsDealer={sellerIsDealer}
            initialInspectedBySeller={initialInspectedBySeller}
          />
          <RejectForm auctionId={auctionId} />
        </>
      ) : (
        <p className="text-sm text-mute">The auction has started, so the report decision can no longer change.</p>
      )}

      {status === "accepted" ? <PublicCopy auctionId={auctionId} reportUrl={reportUrl} /> : null}
    </div>
  );
}

function AcceptForm({
  auctionId,
  accepted,
  initialHighlights,
  sellerIsDealer,
  initialInspectedBySeller,
}: {
  auctionId: string;
  accepted: boolean;
  initialHighlights: string[];
  sellerIsDealer: boolean;
  initialInspectedBySeller: boolean;
}) {
  const action = useAdminAction();
  const [inspectedBySeller, setInspectedBySeller] = useState(initialInspectedBySeller);
  const [checks, setChecks] = useState<Record<ReportCheckKey, boolean>>({
    authorisedDealer: accepted,
    vinMatches: accepted,
    mileageConsistent: accepted,
    dateWithin90Days: accepted,
  });
  const [highlights, setHighlights] = useState<string[]>(
    initialHighlights.length ? initialHighlights : Array.from({ length: INSPECTION_HIGHLIGHTS_MIN }, () => ""),
  );

  return (
    <form
      className="space-y-4 border-t border-line pt-6"
      aria-labelledby="accept-report-heading"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(acceptInspectionReport, { auctionId, checks, highlights, inspectedBySeller: sellerIsDealer && inspectedBySeller });
      }}
    >
      <h3 id="accept-report-heading" className="font-semibold">
        Accept the report
      </h3>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold">Before accepting, confirm all of these</legend>
        <ul className="space-y-2">
          {REPORT_CHECKS.map((c) => {
            const error = action.fieldErrors[`checks.${c.key}`];
            return (
              <li key={c.key}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={checks[c.key]}
                    onChange={(e) => setChecks((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `check-${c.key}-error` : undefined}
                    className="mt-0.5 size-4 shrink-0 accent-[#FF5500]"
                  />
                  <span>{c.label}</span>
                </label>
                {error ? (
                  <p id={`check-${c.key}-error`} className="ml-7 text-xs font-medium text-signal">
                    {error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {sellerIsDealer ? (
        <div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={inspectedBySeller}
              onChange={(e) => setInspectedBySeller(e.target.checked)}
              aria-describedby="inspected-by-seller-hint"
              className="mt-0.5 size-4 shrink-0 accent-[#FF5500]"
            />
            <span className="font-semibold">Inspected by the selling dealer</span>
          </label>
          <p id="inspected-by-seller-hint" className="ml-7 text-xs text-mute">
            Tick if the inspecting dealer is the same business as the seller. The badge stays, but the listing says
            &ldquo;Inspected by the selling dealer&rdquo; instead of implying an independent check.
          </p>
          <FieldNote error={action.fieldErrors.inspectedBySeller} />
        </div>
      ) : null}

      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-sm font-semibold">Highlights from the report</legend>
        <p className="mb-2 text-xs text-mute">
          {INSPECTION_HIGHLIGHTS_MIN} to {INSPECTION_HIGHLIGHTS_MAX} short lines buyers see, e.g. “Brake discs and pads at 70%”.
          No personal details.
        </p>
        <ul className="space-y-2">
          {highlights.map((h, i) => (
            <li key={i} className="flex gap-2">
              <Input
                aria-label={`Highlight ${i + 1}`}
                value={h}
                maxLength={140}
                onChange={(e) => setHighlights((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove highlight ${i + 1}`}
                disabled={highlights.length <= 1}
                onClick={() => setHighlights((list) => list.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          disabled={highlights.length >= INSPECTION_HIGHLIGHTS_MAX}
          onClick={() => setHighlights((list) => [...list, ""])}
        >
          <Plus aria-hidden /> Add highlight
        </Button>
        <FieldNote error={action.fieldErrors.highlights} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={action.pending}>
          {action.pending ? "Saving…" : accepted ? "Save accepted report" : "Accept report"}
        </Button>
        <ActionMessage result={action.result} />
      </div>
    </form>
  );
}

function RejectForm({ auctionId }: { auctionId: string }) {
  const action = useAdminAction();
  const [reason, setReason] = useState("");
  const error = action.fieldErrors.reason;
  return (
    <form
      className="space-y-3 border-t border-line pt-6"
      aria-labelledby="reject-report-heading"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(rejectInspectionReport, { auctionId, reason });
      }}
    >
      <h3 id="reject-report-heading" className="font-semibold">
        Reject the report
      </h3>
      <p className="text-xs text-mute">
        The seller is notified with the reason and has 30 days to upload a new report or list without an inspection (or
        withdraw). Until they choose, the listing can&apos;t be approved. Only for listings waiting for review.
      </p>
      <div>
        <Label htmlFor="reject-report-reason">Reason</Label>
        <Textarea
          id="reject-report-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. Not an authorised dealer"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "reject-report-reason-error" : undefined}
          className="min-h-0 p-3"
        />
        {error ? (
          <p id="reject-report-reason-error" className="mt-1 text-xs font-medium text-signal">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={action.pending}>
          {action.pending ? "Saving…" : "Reject report"}
        </Button>
        <ActionMessage result={action.result} />
      </div>
    </form>
  );
}

/** Optional redacted public copy (PDF) in the public inspection-reports bucket. */
function PublicCopy({ auctionId, reportUrl }: { auctionId: string; reportUrl: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<AdminResult | null>(null);

  async function upload(file: File) {
    setResult(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setResult({ ok: false, error: "Choose a PDF file." });
      return;
    }
    if (file.size > MAX_REPORT_BYTES) {
      setResult({ ok: false, error: "The PDF is larger than 20 MB. Compress it and try again." });
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/admin/inspection-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId }),
      });
      const body = (await res.json().catch(() => ({}))) as { path?: string; token?: string; error?: string };
      if (!res.ok || !body.path || !body.token) {
        setResult({ ok: false, error: body.error ?? "We couldn't start the upload. Try again." });
        return;
      }
      const { error } = await getBrowserSupabase()
        .storage.from(INSPECTION_BUCKET)
        .uploadToSignedUrl(body.path, body.token, file, { contentType: "application/pdf" });
      if (error) {
        setResult({ ok: false, error: "The upload failed. Check your connection and try again." });
        return;
      }
      setResult(await saveInspectionReport({ auctionId, path: body.path }));
    } catch {
      setResult({ ok: false, error: "The upload failed. Check your connection and try again." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border-t border-line pt-6">
      <h3 className="text-sm font-semibold">Public copy of the report (optional)</h3>
      <p className="mt-1 text-xs text-mute">
        A PDF with the seller&apos;s and other personal details blacked out. Buyers can download it from the listing.
      </p>
      {reportUrl ? (
        <a
          href={reportUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-2 text-sm text-chalk underline underline-offset-4 hover:text-signal"
        >
          <FileText aria-hidden className="size-4" /> Open the public copy
        </a>
      ) : (
        <p className="mt-1 text-sm text-mute">No public copy yet.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
          {uploading ? "Uploading…" : reportUrl ? "Replace the public copy" : "Upload a redacted PDF"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <span className="text-xs text-mute">PDF, up to 20 MB.</span>
      </div>
      <ActionMessage result={result} className="mt-3" />
    </div>
  );
}

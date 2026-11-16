"use client";
import { useState } from "react";
import { ExternalLink, FileText, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  HISTORY_CHECKS,
  HISTORY_LINE_MAX,
  HISTORY_SUMMARY_MAX,
  HISTORY_SUMMARY_MIN,
  type HistoryCheckKey,
} from "@/lib/history-report";
import { acceptHistoryReport, rejectHistoryReport } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

export interface HistoryReportView {
  provided: boolean;
  files: { index: number; label: string }[];
  link: string | null;
  shareAllowed: boolean;
  status: "pending" | "accepted" | "rejected" | null;
  note: string | null;
}

/**
 * The seller's carVertical vehicle history report: files (through one-minute
 * signed URLs), the share link, and the checklist to accept or reject it.
 */
export function HistoryPanel({
  auctionId,
  status,
  report,
  initialSummary,
  listingMileage,
  condition,
}: {
  auctionId: string;
  status: string;
  report: HistoryReportView;
  initialSummary: string[];
  listingMileage: string;
  condition: string;
}) {
  if (!report.provided) {
    return <p className="text-sm text-mute">No vehicle history report. The listing shows the standard notice with a link to check the car on carVertical.</p>;
  }
  const reviewable = status === "draft" || status === "upcoming";
  const statusText =
    report.status === "accepted"
      ? "Accepted: the listing shows the History report badge and your summary."
      : report.status === "rejected"
        ? "Rejected. Waiting for the seller to upload another report or correct the description."
        : "Waiting for review.";
  return (
    <div className="space-y-6">
      <div className="space-y-3 text-sm">
        <p>
          <span className="font-semibold">Status:</span> {statusText}
        </p>
        {report.status === "rejected" && report.note ? (
          <p>
            <span className="font-semibold">Reason given to the seller:</span> {report.note}
          </p>
        ) : null}
        {report.status === "pending" && report.note ? (
          <p>
            <span className="font-semibold">Sent again by the seller</span> after you rejected it: {report.note}
          </p>
        ) : null}
        <p className="text-mute">
          Listing: {listingMileage}, {condition}.
        </p>
        {report.files.length ? (
          <ul aria-label="History report files" className="space-y-1">
            {report.files.map((f) => (
              <li key={f.index}>
                <a
                  href={`/api/admin/inspection-file?auction=${auctionId}&file=${f.index}&kind=history`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4 hover:text-signal"
                >
                  <FileText aria-hidden className="size-4" />
                  Open history report {f.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {report.link ? (
          <p>
            <a
              href={report.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4 hover:text-signal"
            >
              <ExternalLink aria-hidden className="size-4" />
              Open the carVertical link
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        ) : null}
        <p>
          <span className="font-semibold">Sharing:</span>{" "}
          {report.shareAllowed
            ? report.link
              ? "The seller allowed sharing: buyers get the link once you accept."
              : "The seller allowed sharing, but gave no link: buyers see your summary only."
            : "Not allowed: buyers see your summary only, never the report or link."}
        </p>
      </div>

      {reviewable && report.status !== "rejected" ? (
        <AcceptHistoryForm auctionId={auctionId} initialSummary={initialSummary} accepted={report.status === "accepted"} />
      ) : null}
      {status === "draft" && report.status !== "rejected" ? <RejectHistoryForm auctionId={auctionId} /> : null}
      {!reviewable ? <p className="text-sm text-mute">Reports can only be reviewed before the auction goes live.</p> : null}
    </div>
  );
}

function AcceptHistoryForm({ auctionId, initialSummary, accepted }: { auctionId: string; initialSummary: string[]; accepted: boolean }) {
  const action = useAdminAction();
  const [checks, setChecks] = useState<Record<HistoryCheckKey, boolean>>(
    () => Object.fromEntries(HISTORY_CHECKS.map((c) => [c.key, accepted])) as Record<HistoryCheckKey, boolean>,
  );
  const [lines, setLines] = useState<string[]>(() =>
    initialSummary.length ? initialSummary : Array.from({ length: HISTORY_SUMMARY_MIN }, () => ""),
  );
  return (
    <form
      className="space-y-4 border-t border-line pt-6"
      aria-labelledby="accept-history-heading"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(acceptHistoryReport, { auctionId, checks, summary: lines });
      }}
    >
      <h3 id="accept-history-heading" className="font-semibold">
        Accept the history report
      </h3>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold">Before accepting, confirm all of these</legend>
        <ul className="space-y-2">
          {HISTORY_CHECKS.map((c) => {
            const error = action.fieldErrors[`checks.${c.key}`];
            return (
              <li key={c.key}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={checks[c.key]}
                    onChange={(e) => setChecks((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `history-check-${c.key}-error` : undefined}
                    className="mt-0.5 size-4 shrink-0 accent-[#FF5500]"
                  />
                  <span>{c.label}</span>
                </label>
                {error ? (
                  <p id={`history-check-${c.key}-error`} className="ml-7 text-xs font-medium text-signal">
                    {error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="min-w-0" aria-describedby="history-summary-hint">
        <legend className="mb-1.5 text-sm font-semibold">Summary for buyers</legend>
        <p id="history-summary-hint" className="mb-2 text-xs text-mute">
          {HISTORY_SUMMARY_MIN} to {HISTORY_SUMMARY_MAX} short lines, up to {HISTORY_LINE_MAX} characters each. For example:
          &ldquo;Mileage records consistent&rdquo;, &ldquo;No recorded damage&rdquo;, &ldquo;2 previous owners&rdquo;,
          &ldquo;First registered in Germany&rdquo;.
        </p>
        <ul className="space-y-2">
          {lines.map((line, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Summary line ${i + 1}`}
                value={line}
                maxLength={HISTORY_LINE_MAX}
                onChange={(e) => setLines((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove summary line ${i + 1}`}
                disabled={lines.length <= 1}
                onClick={() => setLines((list) => list.filter((_, j) => j !== i))}
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
          disabled={lines.length >= HISTORY_SUMMARY_MAX}
          onClick={() => setLines((list) => [...list, ""])}
        >
          <Plus aria-hidden /> Add summary line
        </Button>
        <FieldNote error={action.fieldErrors.summary} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={action.pending}>
          {action.pending ? "Saving…" : accepted ? "Save accepted history report" : "Accept history report"}
        </Button>
        <ActionMessage result={action.result} />
      </div>
    </form>
  );
}

function RejectHistoryForm({ auctionId }: { auctionId: string }) {
  const action = useAdminAction();
  const [reason, setReason] = useState("");
  const error = action.fieldErrors.reason;
  return (
    <form
      className="space-y-3 border-t border-line pt-6"
      aria-labelledby="reject-history-heading"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(rejectHistoryReport, { auctionId, reason });
      }}
    >
      <h3 id="reject-history-heading" className="font-semibold">
        Reject the history report
      </h3>
      <p className="text-xs text-mute">
        The seller is notified with the reason and can upload another report or correct the damage description while the
        listing is in review. Only for listings waiting for review.
      </p>
      <div>
        <Label htmlFor="reject-history-reason">Reason</Label>
        <Textarea
          id="reject-history-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. Report shows damage not mentioned in the listing"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "reject-history-reason-error" : undefined}
          className="min-h-0 p-3"
        />
        {error ? (
          <p id="reject-history-reason-error" className="mt-1 text-xs font-medium text-signal">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={action.pending}>
          {action.pending ? "Saving…" : "Reject history report"}
        </Button>
        <ActionMessage result={action.result} />
      </div>
    </form>
  );
}

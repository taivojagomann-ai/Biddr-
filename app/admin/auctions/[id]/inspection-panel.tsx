"use client";
import { useRef, useState } from "react";
import { FileText, Loader2, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INSPECTION_BUCKET, MAX_HIGHLIGHTS, MAX_REPORT_BYTES, type AdminResult } from "@/lib/admin-schemas";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { saveInspection, saveInspectionReport } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

export function InspectionPanel({
  auctionId,
  restored,
  initial,
  reportUrl,
}: {
  auctionId: string;
  restored: boolean;
  initial: { partnerName: string; inspectionDate: string; highlights: string[] };
  reportUrl: string | null;
}) {
  const [partnerName, setPartnerName] = useState(initial.partnerName);
  const [inspectionDate, setInspectionDate] = useState(initial.inspectionDate);
  const [highlights, setHighlights] = useState<string[]>(initial.highlights.length ? initial.highlights : [""]);
  const details = useAdminAction();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<AdminResult | null>(null);

  async function uploadReport(file: File) {
    setUploadResult(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadResult({ ok: false, error: "Choose a PDF file." });
      return;
    }
    if (file.size > MAX_REPORT_BYTES) {
      setUploadResult({ ok: false, error: "The PDF is larger than 20 MB. Compress it and try again." });
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
        setUploadResult({ ok: false, error: body.error ?? "We couldn't start the upload. Try again." });
        return;
      }
      const { error } = await getBrowserSupabase()
        .storage.from(INSPECTION_BUCKET)
        .uploadToSignedUrl(body.path, body.token, file, { contentType: "application/pdf" });
      if (error) {
        setUploadResult({ ok: false, error: "The upload failed. Check your connection and try again." });
        return;
      }
      setUploadResult(await saveInspectionReport({ auctionId, path: body.path }));
    } catch {
      setUploadResult({ ok: false, error: "The upload failed. Check your connection and try again." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void details.run(saveInspection, { auctionId, partnerName, inspectionDate, highlights });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="insp-partner" optional={!restored}>
              Inspection partner
            </Label>
            <Input id="insp-partner" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} maxLength={80} />
            <FieldNote error={details.fieldErrors.partnerName} hint="Shown to bidders as “Verified by …”." />
          </div>
          <div>
            <Label htmlFor="insp-date" optional>
              Inspection date
            </Label>
            <Input id="insp-date" type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
            <FieldNote error={details.fieldErrors.inspectionDate} />
          </div>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold">Highlights</legend>
          <p className="mb-2 text-xs text-mute">Short lines bidders see first, e.g. “Paint thickness measured on all panels”.</p>
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
                  onClick={() => setHighlights((list) => (list.length === 1 ? [""] : list.filter((_, j) => j !== i)))}
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
            disabled={highlights.length >= MAX_HIGHLIGHTS}
            onClick={() => setHighlights((list) => [...list, ""])}
          >
            <Plus aria-hidden /> Add highlight
          </Button>
          <FieldNote error={details.fieldErrors.highlights} />
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={details.pending}>
            {details.pending ? "Saving…" : "Save inspection details"}
          </Button>
          <ActionMessage result={details.result} />
        </div>
      </form>

      <div className="border-t border-line pt-6">
        <h3 className="text-sm font-semibold">Inspection report (PDF)</h3>
        {reportUrl ? (
          <a
            href={reportUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-2 text-sm text-chalk underline underline-offset-4 hover:text-signal"
          >
            <FileText aria-hidden className="size-4" /> Open the current report
          </a>
        ) : (
          <p className="mt-1 text-sm text-mute">No report attached yet.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
            {uploading ? "Uploading…" : reportUrl ? "Replace the PDF" : "Upload the PDF"}
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
              if (file) void uploadReport(file);
            }}
          />
          <span className="text-xs text-mute">PDF, up to 20 MB. Bidders can open it from the listing.</span>
        </div>
        <ActionMessage result={uploadResult} className="mt-3" />
      </div>
    </div>
  );
}

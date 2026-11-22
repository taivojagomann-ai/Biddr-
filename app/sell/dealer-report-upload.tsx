"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPT_PHOTOS_AND_PDF, FORMATS_TEXT, isPdfFile, isPhotoFile } from "@/lib/file-types";
import { PhotoError, randomId, uploadableFile, uploadBlob } from "@/lib/photo-upload";
import {
  MAX_REPORT_BYTES,
  MAX_REPORT_FILES,
  REPORT_BUCKET,
  REPORT_TYPES,
  type ReportFile,
} from "@/lib/sell";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { FieldError, fieldId } from "./field";

interface Pending {
  id: string;
  name: string;
  file: File;
  progress: number;
  status: "uploading" | "error";
  error?: string;
}


/**
 * Uploads the dealer's inspection report (PDF or photos, up to 10 files) to the
 * private inspection-uploads bucket, under <user id>/<draft id>/. Finished files
 * are reported through onChange; files still uploading through onBusyChange.
 */
export function DealerReportUpload({
  userId,
  draftId,
  files,
  onChange,
  onBusyChange,
  error,
  idBase,
  title = "Inspection report",
  hint,
  buttonLabel = "Add report files",
  listLabel = "Report files",
}: {
  userId: string;
  draftId: string;
  files: ReportFile[];
  onChange: (next: ReportFile[]) => void;
  onBusyChange: (busy: boolean) => void;
  error?: string;
  /** Id for the button (and its hint and error); defaults to the sell form's field id. */
  idBase?: string;
  /** Texts, so the same uploader serves the dealer report and the vehicle history report. */
  title?: string;
  hint?: React.ReactNode;
  buttonLabel?: string;
  listLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<string>();
  const [status, setStatus] = useState("");
  const filesRef = useRef(files);
  filesRef.current = files;
  const id = idBase ?? fieldId("reportFiles");
  const room = MAX_REPORT_FILES - files.length - pending.length;

  useEffect(() => onBusyChange(pending.some((p) => p.status === "uploading")), [pending, onBusyChange]);

  const upload = async (item: Pending) => {
    try {
      // HEIC (and photos without a type) become JPEG; PDF, JPEG, PNG and WebP stay as they are.
      const { blob, contentType: type } = await uploadableFile(item.file);
      if (blob.size > MAX_REPORT_BYTES) throw new PhotoError(`${item.name} is larger than 20 MB.`);
      const path = `${userId}/${draftId}/${randomId()}.${REPORT_TYPES[type]}`;
      const { data: { session } } = await getBrowserSupabase().auth.getSession();
      if (!session) throw new PhotoError("Your session has expired. Reload the page.");
      await uploadBlob({
        bucket: REPORT_BUCKET,
        path,
        blob,
        contentType: type,
        accessToken: session.access_token,
        tooLarge: `${item.name} is larger than 20 MB.`,
        onProgress: (progress) => setPending((list) => list.map((p) => (p.id === item.id ? { ...p, progress } : p))),
      });
      setPending((list) => list.filter((p) => p.id !== item.id));
      onChange([...filesRef.current, { path, name: item.name }]);
      setStatus(`${item.name} uploaded.`);
    } catch (e) {
      const message = e instanceof PhotoError ? e.message : "Upload failed. Check your connection and retry.";
      setPending((list) => list.map((p) => (p.id === item.id ? { ...p, status: "error", error: message } : p)));
      setStatus(`${item.name} didn't upload. ${message}`);
    }
  };

  const add = (picked: File[]) => {
    const problems: string[] = [];
    const accepted: Pending[] = [];
    for (const file of picked) {
      if (!isPdfFile(file) && !isPhotoFile(file)) problems.push(`${file.name} isn't a PDF or a photo. Add ${FORMATS_TEXT} files.`);
      else if (isPdfFile(file) && file.size > MAX_REPORT_BYTES) problems.push(`${file.name} is larger than 20 MB.`);
      else if (accepted.length >= room) problems.push(`${file.name} wasn't added: the limit is ${MAX_REPORT_FILES} files.`);
      else accepted.push({ id: randomId(), name: file.name.slice(0, 200), file, progress: 0, status: "uploading" });
    }
    setNotice(problems.length ? problems.slice(0, 3).join(" ") : undefined);
    if (!accepted.length) return;
    setPending((list) => [...list, ...accepted]);
    setStatus(`Uploading ${accepted.length} ${accepted.length === 1 ? "file" : "files"}…`);
    for (const item of accepted) void upload(item);
  };

  const remove = (file: ReportFile) => {
    onChange(filesRef.current.filter((f) => f.path !== file.path));
    void getBrowserSupabase().storage.from(REPORT_BUCKET).remove([file.path]);
    setStatus(`${file.name} removed.`);
  };

  const retry = (item: Pending) => {
    const next = { ...item, status: "uploading" as const, progress: 0, error: undefined };
    setPending((list) => list.map((p) => (p.id === item.id ? next : p)));
    void upload(next);
  };

  const describedBy = [error ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(" ");

  return (
    <div className={cn("rounded-lg border bg-panel p-4", error ? "border-signal" : "border-line")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p id={`${id}-hint`} className="text-xs text-mute">
            {hint ?? (
              <>
                PDF or photos of every page ({FORMATS_TEXT}), up to {MAX_REPORT_FILES} files, 20 MB each. Only Biddr&apos;s team sees this
                file. We&apos;ll publish a summary, not your personal details.
              </>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          id={id}
          onClick={() => inputRef.current?.click()}
          disabled={room <= 0}
          aria-describedby={describedBy}
        >
          <Upload aria-hidden />
          {buttonLabel}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_PHOTOS_AND_PDF}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (picked.length) add(picked);
          }}
        />
      </div>

      {files.length + pending.length > 0 ? (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line" aria-label={listLabel}>
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <FileText aria-hidden className="size-4 shrink-0 text-mute" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => remove(f)}
                className="inline-flex size-11 items-center justify-center rounded-md text-mute hover:text-chalk"
                aria-label={`Remove ${f.name}`}
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              {p.status === "uploading" ? (
                <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-mute" />
              ) : (
                <FileText aria-hidden className="size-4 shrink-0 text-signal" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className={cn("block text-xs", p.status === "error" ? "text-signal" : "text-mute")}>
                  {p.status === "error" ? p.error : `Uploading, ${Math.round(p.progress * 100)}%`}
                </span>
              </span>
              {p.status === "error" ? (
                <>
                  <button
                    type="button"
                    onClick={() => retry(p)}
                    className="inline-flex size-11 items-center justify-center rounded-md text-mute hover:text-chalk"
                    aria-label={`Retry ${p.name}`}
                  >
                    <RotateCcw aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPending((list) => list.filter((x) => x.id !== p.id))}
                    className="inline-flex size-11 items-center justify-center rounded-md text-mute hover:text-chalk"
                    aria-label={`Remove ${p.name}`}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {notice ? <p className="mt-3 text-xs text-signal">{notice}</p> : null}
      <div className="mt-1.5">
        <FieldError id={`${id}-error`} error={error} />
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}

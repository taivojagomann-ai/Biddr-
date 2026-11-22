"use client";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPT_PHOTOS_AND_PDF, FORMATS_TEXT, isPdfFile, isPhotoFile } from "@/lib/file-types";
import { verificationFolder } from "@/lib/listing-checks/challenge";
import { PhotoError, resizePhoto } from "@/lib/photo-upload";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { saveDocuments } from "./actions";

type Kind = "registration" | "authorisation";
type Doc = { path: string; name: string };

const MAX_FILES = 4;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** One list of files (the registration certificate, or the owner's authorisation): PDF or photos, uploaded privately. */
function FileList({
  kind,
  label,
  hint,
  files,
  onChange,
  folder,
  disabled,
}: {
  kind: Kind;
  label: string;
  hint: string;
  files: Doc[];
  onChange: (files: Doc[]) => void;
  folder: string;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const chosen = Array.from(list).slice(0, MAX_FILES - files.length);
    setBusy(true);
    const supabase = getBrowserSupabase();
    const added: Doc[] = [];
    for (const file of chosen) {
      try {
        let blob: Blob = file;
        let ext = "pdf";
        let contentType = "application/pdf";
        if (isPdfFile(file)) {
          if (file.size > MAX_PDF_BYTES) throw new PhotoError(`${file.name} is larger than 20 MB.`);
        } else if (isPhotoFile(file)) {
          const photo = await resizePhoto(file);
          blob = photo.blob;
          ext = photo.ext;
          contentType = photo.contentType;
        } else {
          throw new PhotoError(`${file.name} isn't a PDF or a photo. Add ${FORMATS_TEXT} files.`);
        }
        const path = `${folder}/${kind}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("inspection-uploads").upload(path, blob, { contentType });
        if (upErr) throw new PhotoError(`${file.name} didn't upload. Try again.`);
        added.push({ path, name: file.name });
      } catch (e) {
        setError(e instanceof PhotoError ? e.message : `${file.name} couldn't be added. Try again.`);
      }
    }
    setBusy(false);
    if (added.length) onChange([...files, ...added]);
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      <p id={`${id}-label`} className="text-sm font-semibold">
        {label}
      </p>
      <p id={`${id}-hint`} className="mt-1 text-xs text-mute">
        {hint}
      </p>
      {files.length ? (
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <li key={f.path} className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-asphalt/40 px-3 text-sm">
              <FileText aria-hidden className="size-4 shrink-0 text-mute" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                disabled={disabled}
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((x) => x.path !== f.path))}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length < MAX_FILES ? (
        <>
          <input
            ref={input}
            id={`${id}-input`}
            type="file"
            accept={ACCEPT_PHOTOS_AND_PDF}
            multiple
            className="sr-only"
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
            disabled={disabled || busy}
            onChange={(e) => void add(e.target.files)}
          />
          <Button type="button" variant="outline" className="mt-2 min-h-11" disabled={disabled || busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
            {files.length ? "Add another file" : "Add files"}
            <span className="sr-only">: {label}</span>
          </Button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-signal">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The registration certificate (required) and, if the seller isn't the owner, the owner's signed authorisation. */
export function DocumentsForm({
  auctionId,
  userId,
  initial,
  locked,
}: {
  auctionId: string;
  userId: string;
  initial: { registration: Doc[]; sellerIsOwner: boolean; authorisation: Doc[] };
  locked: boolean;
}) {
  const router = useRouter();
  const folder = verificationFolder(userId, auctionId);
  const [registration, setRegistration] = useState(initial.registration);
  const [sellerIsOwner, setSellerIsOwner] = useState(initial.sellerIsOwner);
  const [authorisation, setAuthorisation] = useState(initial.authorisation);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setResult(null);
    const r = await saveDocuments({
      auctionId,
      registrationPaths: registration.map((d) => d.path),
      sellerIsOwner,
      authorisationPaths: authorisation.map((d) => d.path),
    });
    setBusy(false);
    setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-5">
      <FileList
        kind="registration"
        label="Registration certificate"
        hint={`Both sides if it has two, as a PDF or clear photos (${FORMATS_TEXT}). Only Biddr's team sees it, to check the VIN and the owner; it's deleted 30 days after the auction ends.`}
        files={registration}
        onChange={setRegistration}
        folder={folder}
        disabled={locked || busy}
      />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={!sellerIsOwner}
          onChange={(e) => setSellerIsOwner(!e.target.checked)}
          disabled={locked || busy}
          className="mt-0.5 size-4 shrink-0 accent-[#FF5500]"
        />
        <span>
          I&apos;m not the registered owner (for example, I&apos;m selling it for a family member)
          <span className="block text-xs text-mute">Dealers selling a car registered to their company don&apos;t need to tick this.</span>
        </span>
      </label>
      {!sellerIsOwner ? (
        <FileList
          kind="authorisation"
          label="The owner's signed authorisation"
          hint="A letter signed by the registered owner that allows you to sell this car, with the owner's name, your name and the VIN. Biddr's team checks it."
          files={authorisation}
          onChange={setAuthorisation}
          folder={folder}
          disabled={locked || busy}
        />
      ) : null}
      <Button type="button" className="min-h-11" disabled={locked || busy || !registration.length || (!sellerIsOwner && !authorisation.length)} onClick={() => void save()}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        Save documents
      </Button>
      <p role="status" aria-live="polite" className={result && !result.ok ? "text-sm text-signal" : "text-sm text-mute"}>
        {result?.text ?? ""}
      </p>
    </div>
  );
}

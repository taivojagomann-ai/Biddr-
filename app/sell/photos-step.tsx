import { useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, ImagePlus, Loader2, RotateCw, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_PHOTOS_PER_SECTION, photoSectionsFor, type PhotoSection, type SellErrors } from "@/lib/sell";
import { cn } from "@/lib/utils";
import { Field, FieldError, StepHeading, fieldId, fieldProps } from "./field";
import type { UploadItem, Uploads } from "./types";

export interface PhotosStepProps {
  uploads: Uploads;
  restored: boolean;
  errors: SellErrors;
  notices: Partial<Record<PhotoSection, string>>;
  pendingError?: string;
  videoUrl: string;
  onVideoUrl: (v: string) => void;
  onAdd: (section: PhotoSection, files: File[]) => void;
  onRemove: (section: PhotoSection, id: string) => void;
  onRetry: (section: PhotoSection, id: string) => void;
  onMove: (section: PhotoSection, from: number, to: number) => void;
}

export function PhotosStep(props: PhotosStepProps) {
  const { restored, errors } = props;
  return (
    <section>
      <StepHeading
        title="Photos"
        intro="Clear, daylight photos sell cars. Shoot in landscape and include any flaws; bidders trust honest listings."
      />
      {props.pendingError ? (
        <p role="alert" className="mb-6 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm">
          {props.pendingError}
        </p>
      ) : null}
      <div className="space-y-8">
        {photoSectionsFor(restored).map((s) => (
          <PhotoSectionBlock
            key={s.key}
            section={s.key}
            label={s.label}
            hint={s.hint}
            min={s.min}
            items={props.uploads[s.key]}
            error={errors[`photos.${s.key}`]}
            notice={props.notices[s.key]}
            onAdd={props.onAdd}
            onRemove={props.onRemove}
            onRetry={props.onRetry}
            onMove={props.onMove}
          />
        ))}
      </div>

      <Field
        field="videoUrl"
        label="Cold start and walkaround video"
        optional
        error={errors.videoUrl}
        hint="A YouTube or Vimeo link. Start the engine from cold, then walk around the car."
        className="mt-10"
      >
        <Input
          {...fieldProps("videoUrl", errors.videoUrl, true)}
          type="url"
          inputMode="url"
          value={props.videoUrl}
          onChange={(e) => props.onVideoUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
    </section>
  );
}

function PhotoSectionBlock({
  section,
  label,
  hint,
  min,
  items,
  error,
  notice,
  onAdd,
  onRemove,
  onRetry,
  onMove,
}: {
  section: PhotoSection;
  label: string;
  hint: string;
  min: number;
  items: UploadItem[];
  error?: string;
  notice?: string;
  onAdd: PhotosStepProps["onAdd"];
  onRemove: PhotosStepProps["onRemove"];
  onRetry: PhotosStepProps["onRetry"];
  onMove: PhotosStepProps["onMove"];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const id = fieldId(`photos.${section}`);
  const done = items.filter((i) => i.status === "done").length;
  const busy = items.filter((i) => i.status === "queued" || i.status === "processing" || i.status === "uploading").length;
  const failed = items.filter((i) => i.status === "error").length;
  // Announced politely when uploads finish or fail; per-photo progress stays visual only.
  const summary = busy
    ? `Uploading ${busy} ${busy === 1 ? "photo" : "photos"}.`
    : `${label}: ${done} of at least ${min} photos added.${failed ? ` ${failed} failed to upload.` : ""}`;
  const full = items.length >= MAX_PHOTOS_PER_SECTION;

  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={error ? `${id}-error` : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDropActive(false);
          onAdd(section, Array.from(e.dataTransfer.files));
        }
      }}
      className={cn("rounded-lg border bg-panel p-4", error ? "border-signal" : "border-line", dropActive && "border-signal")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${id}-label`} className="font-semibold">
            {label}
          </h3>
          <p className="text-xs text-mute">{hint}</p>
          <p className="mt-1 text-xs">
            <span className={cn(done >= min ? "text-verified" : "text-mute")}>
              {done} of at least {min} added
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          id={id}
          onClick={() => inputRef.current?.click()}
          disabled={full}
        >
          <ImagePlus aria-hidden />
          Add photos
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) onAdd(section, files);
          }}
        />
      </div>

      <p role="status" className="sr-only">
        {summary}
      </p>

      {section === "exterior" ? (
        <p className="mt-2 text-xs text-mute">
          The first exterior photo is the cover photo. Drag photos, or use the arrows, to change the order.
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="mt-3 text-xs text-signal">
          {notice}
        </p>
      ) : null}
      <div className="mt-1.5">
        <FieldError id={`${id}-error`} error={error} />
      </div>

      {items.length ? (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item, index) => (
            <li
              key={item.id}
              draggable={item.status === "done"}
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(e) => {
                if (dragIndex !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.stopPropagation();
                if (dragIndex !== index) onMove(section, dragIndex, index);
                setDragIndex(null);
              }}
              className={cn(
                "group relative overflow-hidden rounded-md border border-line bg-asphalt",
                dragIndex === index && "opacity-40",
              )}
            >
              <div className="relative aspect-[4/3]">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob: previews */}
                <img
                  src={item.preview}
                  alt={`${label} photo ${index + 1}`}
                  className={cn("h-full w-full object-cover", item.status !== "done" && "opacity-50")}
                  draggable={false}
                />
                {section === "exterior" && index === 0 ? (
                  <span className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-sm bg-signal px-1.5 py-0.5 text-[11px] font-bold text-asphalt">
                    <Star aria-hidden className="size-3" />
                    Cover
                  </span>
                ) : null}
                <StatusOverlay item={item} onRetry={() => onRetry(section, item.id)} />
              </div>
              <div className="flex items-center justify-between gap-1 p-1">
                <div className="flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Move ${label.toLowerCase()} photo ${index + 1} earlier`}
                    disabled={index === 0 || item.status !== "done"}
                    onClick={() => onMove(section, index, index - 1)}
                  >
                    <ArrowLeft aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Move ${label.toLowerCase()} photo ${index + 1} later`}
                    disabled={index === items.length - 1 || item.status !== "done"}
                    onClick={() => onMove(section, index, index + 1)}
                  >
                    <ArrowRight aria-hidden />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Remove ${label.toLowerCase()} photo ${index + 1}`}
                  onClick={() => onRemove(section, item.id)}
                >
                  <X aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-field px-4 py-8 text-sm text-mute hover:border-chalk"
        >
          <ImagePlus aria-hidden className="size-6" />
          Tap to add photos, or drop them here
        </button>
      )}
    </div>
  );
}

function StatusOverlay({ item, onRetry }: { item: UploadItem; onRetry: () => void }) {
  if (item.status === "done") return null;
  if (item.status === "error") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-asphalt/80 p-2 text-center">
        <AlertCircle aria-hidden className="size-5 text-signal" />
        <p className="text-[11px] leading-tight">{item.error ?? "Upload failed."}</p>
        {item.file ? (
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            <RotateCw aria-hidden />
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  const pct = Math.round(item.progress * 100);
  const label = item.status === "uploading" ? `Uploading ${pct}%` : item.status === "processing" ? "Resizing…" : "Waiting…";
  return (
    <div className="absolute inset-x-0 bottom-0 bg-asphalt/80 p-2">
      <p className="flex items-center gap-1.5 text-[11px]">
        <Loader2 aria-hidden className="size-3 animate-spin" />
        {label}
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-signal transition-[width]" style={{ width: `${item.status === "uploading" ? pct : 5}%` }} />
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoError, precheckFile, randomId, resizePhoto, uploadToStorage } from "@/lib/photo-upload";
import {
  FIELD_STEP,
  MAX_PHOTOS_PER_SECTION,
  PHOTO_BUCKET,
  PHOTO_SECTION_KEYS,
  STEPS,
  draftFolder,
  emptySellInput,
  firstErrorStep,
  photoSectionsFor,
  publicBucketPrefix,
  storageKey,
  validateAll,
  validateStep,
  type PhotoSection,
  type SellErrors,
  type SellField,
  type SellInput,
  type SellPhotos,
  type StepId,
} from "@/lib/sell";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Country } from "@/lib/types";
import { cn } from "@/lib/utils";
import { submitListing } from "./actions";
import { CarStep } from "./car-step";
import { STEP_HEADING_ID, fieldId } from "./field";
import { HistoryStep } from "./history-step";
import { PhotosStep } from "./photos-step";
import { PriceStep } from "./price-step";
import { ReviewStep } from "./review-step";
import type { SellValues, UploadItem, Uploads } from "./types";

const MAX_PARALLEL_UPLOADS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_PHOTOS = "Wait for your photos to finish uploading, or remove the ones that failed.";

interface Persisted {
  v: 1;
  draftId: string;
  step: StepId;
  furthest: StepId;
  values: SellValues;
  photos: SellPhotos;
}

function emptyValues(country: Country | ""): SellValues {
  const { photos: _photos, draftId: _draftId, ...values } = emptySellInput("", country);
  return values;
}

function emptyUploads(): Uploads {
  return { exterior: [], interior: [], mechanical: [], before: [] };
}

function bucketPrefix(): string {
  return publicBucketPrefix(process.env.NEXT_PUBLIC_SUPABASE_URL!);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStep(v: unknown): StepId {
  return typeof v === "number" && STEPS.some((s) => s.id === v) ? (v as StepId) : 1;
}

/** Reads a saved draft defensively: unknown keys are dropped, wrong types fall back to defaults. */
function readPersisted(raw: unknown, country: Country | ""): Persisted | null {
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.draftId !== "string" || !UUID_RE.test(raw.draftId)) return null;
  const values = emptyValues(country);
  const savedValues = isRecord(raw.values) ? raw.values : {};
  for (const key of Object.keys(values) as (keyof SellValues)[]) {
    const saved = savedValues[key];
    if (typeof saved === typeof values[key]) Object.assign(values, { [key]: saved });
  }
  const photos: SellPhotos = { exterior: [], interior: [], mechanical: [], before: [] };
  const savedPhotos = isRecord(raw.photos) ? raw.photos : {};
  const prefix = bucketPrefix();
  for (const section of PHOTO_SECTION_KEYS) {
    const list = savedPhotos[section];
    if (Array.isArray(list)) {
      photos[section] = list
        .filter((u): u is string => typeof u === "string" && u.startsWith(prefix))
        .slice(0, MAX_PHOTOS_PER_SECTION);
    }
  }
  return { v: 1, draftId: raw.draftId, step: asStep(raw.step), furthest: asStep(raw.furthest), values, photos };
}

function doneItem(url: string): UploadItem {
  return { id: randomId(), status: "done", progress: 1, preview: url, url, path: url.slice(bucketPrefix().length) };
}

function revoke(item: UploadItem) {
  if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
}

function describeRejected(messages: string[], tooMany: number): string | undefined {
  const parts = messages.slice(0, 2);
  if (messages.length > 2) parts.push(`${messages.length - 2} more files couldn't be added.`);
  if (tooMany) parts.push(`${tooMany} ${tooMany === 1 ? "photo was" : "photos were"} not added: the limit is ${MAX_PHOTOS_PER_SECTION} per section.`);
  return parts.length ? parts.join(" ") : undefined;
}

export function SellForm({ userId, defaultCountry }: { userId: string; defaultCountry: Country | "" }) {
  const router = useRouter();
  const key = storageKey(userId);

  const [loaded, setLoaded] = useState(false);
  const [draftId, setDraftId] = useState("");
  const [values, setValues] = useState<SellValues>(() => emptyValues(defaultCountry));
  const [uploads, setUploads] = useState<Uploads>(emptyUploads);
  const [step, setStep] = useState<StepId>(1);
  const [furthest, setFurthest] = useState<StepId>(1);
  const [errors, setErrors] = useState<SellErrors>({});
  const [pendingError, setPendingError] = useState<string>();
  const [notices, setNotices] = useState<Partial<Record<PhotoSection, string>>>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const uploadsRef = useRef<Uploads>(uploads);
  const draftIdRef = useRef("");
  const submittedRef = useRef(false);
  const queue = useRef<(() => Promise<void>)[]>([]);
  const active = useRef(0);
  const controllers = useRef(new Map<string, AbortController>());
  const topRef = useRef<HTMLDivElement>(null);

  // The ref is the source of truth so async upload jobs see changes immediately;
  // React state follows it for rendering.
  const updateUploads = useCallback((fn: (prev: Uploads) => Uploads) => {
    const next = fn(uploadsRef.current);
    if (next === uploadsRef.current) return;
    uploadsRef.current = next;
    setUploads(next);
  }, []);

  const patchItem = useCallback(
    (section: PhotoSection, id: string, patch: Partial<UploadItem>) =>
      updateUploads((prev) => ({ ...prev, [section]: prev[section].map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
    [updateUploads],
  );

  const exists = (section: PhotoSection, id: string) => uploadsRef.current[section].some((i) => i.id === id);

  // ---------------------------------------------------------------------------
  // Restore and save the draft (localStorage, one key per user)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let saved: Persisted | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) saved = readPersisted(JSON.parse(raw), defaultCountry);
    } catch {
      saved = null;
    }
    if (saved) {
      const restored = emptyUploads();
      for (const s of PHOTO_SECTION_KEYS) restored[s] = saved.photos[s].map(doneItem);
      uploadsRef.current = restored;
      setUploads(restored);
      setValues(saved.values);
      setStep(saved.step);
      setFurthest(saved.furthest >= saved.step ? saved.furthest : saved.step);
      setDraftId(saved.draftId);
      draftIdRef.current = saved.draftId;
    } else {
      const id = randomId();
      setDraftId(id);
      draftIdRef.current = id;
    }
    setLoaded(true);
  }, [key, defaultCountry]);

  const photos = useMemo<SellPhotos>(() => {
    const out: SellPhotos = { exterior: [], interior: [], mechanical: [], before: [] };
    for (const s of PHOTO_SECTION_KEYS) {
      out[s] = uploads[s].flatMap((i) => (i.status === "done" && i.url ? [i.url] : []));
    }
    return out;
  }, [uploads]);

  useEffect(() => {
    if (!loaded || submittedRef.current) return;
    const data: Persisted = { v: 1, draftId, step, furthest, values, photos };
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Storage full or disabled: the form still works, it just won't survive a refresh.
    }
  }, [loaded, key, draftId, step, furthest, values, photos]);

  // Abort uploads if the user leaves the page.
  useEffect(() => {
    const map = controllers.current;
    return () => map.forEach((c) => c.abort());
  }, []);

  const input: SellInput = useMemo(() => ({ ...values, draftId, photos }), [values, draftId, photos]);
  const restored = values.hadDamage === "yes";

  // ---------------------------------------------------------------------------
  // Field updates
  // ---------------------------------------------------------------------------
  const set = useCallback(<K extends keyof SellValues>(field: K, value: SellValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const linked: SellField[] =
        field === "make" ? ["make", "makeOther"] : field === "hadDamage" ? ["hadDamage", "damageSummary"] : [];
      const keys = [field as SellField, ...linked];
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
    setFormError(undefined);
  }, []);

  // ---------------------------------------------------------------------------
  // Photo uploads
  // ---------------------------------------------------------------------------
  const pump = useRef<() => void>(() => undefined);
  pump.current = () => {
    while (active.current < MAX_PARALLEL_UPLOADS && queue.current.length) {
      const job = queue.current.shift();
      if (!job) break;
      active.current += 1;
      void job().finally(() => {
        active.current -= 1;
        pump.current();
      });
    }
  };

  const enqueue = (section: PhotoSection, id: string, file: File) => {
    queue.current.push(async () => {
      if (!exists(section, id)) return;
      patchItem(section, id, { status: "processing", progress: 0, error: undefined });
      const controller = new AbortController();
      controllers.current.set(id, controller);
      try {
        const photo = await resizePhoto(file);
        if (!exists(section, id)) return;
        const { data: { session } } = await getBrowserSupabase().auth.getSession();
        if (!session) throw new PhotoError("Your session has expired. Reload the page.");
        const path = `${draftFolder(userId, draftIdRef.current)}${section}/${randomId()}.${photo.ext}`;
        patchItem(section, id, { status: "uploading" });
        await uploadToStorage({
          path,
          photo,
          accessToken: session.access_token,
          signal: controller.signal,
          onProgress: (progress) => patchItem(section, id, { progress }),
        });
        if (!exists(section, id) || controller.signal.aborted) {
          void getBrowserSupabase().storage.from(PHOTO_BUCKET).remove([path]);
          return;
        }
        patchItem(section, id, { status: "done", progress: 1, url: bucketPrefix() + path, path, file: undefined });
      } catch (e) {
        if (exists(section, id) && !controller.signal.aborted) {
          patchItem(section, id, {
            status: "error",
            error: e instanceof PhotoError ? e.message : "Upload failed. Check your connection and retry.",
          });
        }
      } finally {
        controllers.current.delete(id);
      }
    });
    pump.current();
  };

  const addPhotos = (section: PhotoSection, files: File[]) => {
    const room = MAX_PHOTOS_PER_SECTION - uploadsRef.current[section].length;
    const rejected: string[] = [];
    const accepted: File[] = [];
    let tooMany = 0;
    for (const file of files) {
      const problem = precheckFile(file);
      if (problem) rejected.push(problem);
      else if (accepted.length >= room) tooMany += 1;
      else accepted.push(file);
    }
    setNotices((prev) => ({ ...prev, [section]: describeRejected(rejected, tooMany) }));
    if (!accepted.length) return;

    const items: UploadItem[] = accepted.map((file) => ({
      id: randomId(),
      status: "queued",
      progress: 0,
      preview: URL.createObjectURL(file),
      file,
    }));
    updateUploads((prev) => ({ ...prev, [section]: [...prev[section], ...items] }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`photos.${section}`];
      return next;
    });
    setPendingError(undefined);
    for (const item of items) if (item.file) enqueue(section, item.id, item.file);
  };

  const removePhoto = (section: PhotoSection, id: string) => {
    const item = uploadsRef.current[section].find((i) => i.id === id);
    if (!item) return;
    controllers.current.get(id)?.abort();
    updateUploads((prev) => ({ ...prev, [section]: prev[section].filter((i) => i.id !== id) }));
    revoke(item);
    if (item.path) void getBrowserSupabase().storage.from(PHOTO_BUCKET).remove([item.path]);
  };

  const retryPhoto = (section: PhotoSection, id: string) => {
    const item = uploadsRef.current[section].find((i) => i.id === id);
    if (!item?.file) return;
    patchItem(section, id, { status: "queued", progress: 0, error: undefined });
    enqueue(section, id, item.file);
  };

  const movePhoto = (section: PhotoSection, from: number, to: number) => {
    updateUploads((prev) => {
      const list = [...prev[section]];
      if (to < 0 || to >= list.length) return prev;
      const [moved] = list.splice(from, 1);
      if (!moved) return prev;
      list.splice(to, 0, moved);
      return { ...prev, [section]: list };
    });
  };

  const hasPendingUploads = () =>
    photoSectionsFor(restored).some((s) => uploadsRef.current[s.key].some((i) => i.status !== "done"));

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // When the step changes (not on first load), move focus to the new step's heading.
  const stepRef = useRef<StepId | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (stepRef.current !== null && stepRef.current !== step) {
      document.getElementById(STEP_HEADING_ID)?.focus({ preventScroll: true });
    }
    stepRef.current = step;
  }, [step, loaded]);

  const focusFirstError = (errs: SellErrors) => {
    const first = (Object.keys(FIELD_STEP) as SellField[]).find((k) => errs[k]);
    if (!first) return;
    window.setTimeout(() => {
      const el = document.getElementById(fieldId(first));
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    }, 0);
  };

  const goTo = (target: StepId) => {
    if (target > furthest) return;
    setPendingError(undefined);
    setFormError(undefined);
    setStep(target);
    scrollTop();
  };

  const onContinue = () => {
    const errs = validateStep(step, input);
    const pending = step === 3 && hasPendingUploads();
    setErrors(errs);
    setPendingError(pending ? PENDING_PHOTOS : undefined);
    if (Object.keys(errs).length) {
      focusFirstError(errs);
      return;
    }
    if (pending) {
      scrollTop();
      return;
    }
    const next = (step + 1) as StepId;
    setStep(next);
    setFurthest((f) => (next > f ? next : f));
    scrollTop();
  };

  const onBack = () => {
    if (step > 1) goTo((step - 1) as StepId);
  };

  const showErrors = (errs: SellErrors) => {
    setErrors(errs);
    const target = firstErrorStep(errs);
    if (target && target !== step) {
      setStep(target);
      scrollTop();
    }
    focusFirstError(errs);
  };

  const onSubmit = async () => {
    if (submitting) return;
    setFormError(undefined);
    const errs = validateAll(input);
    if (Object.keys(errs).length) {
      showErrors(errs);
      return;
    }
    if (hasPendingUploads()) {
      setPendingError(PENDING_PHOTOS);
      setStep(3);
      scrollTop();
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitListing(input);
      if (result.ok) {
        submittedRef.current = true;
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore
        }
        router.replace(`/sell/submitted?id=${encodeURIComponent(result.id)}`);
        return;
      }
      if (result.errors && Object.keys(result.errors).length) showErrors(result.errors);
      if (result.error) setFormError(result.error);
      setSubmitting(false);
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again; your answers are saved.");
      setSubmitting(false);
    }
  };

  const startOver = () => {
    if (!window.confirm("Start over? This clears your answers and deletes the photos you uploaded.")) return;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    queue.current = [];
    const paths: string[] = [];
    for (const s of PHOTO_SECTION_KEYS) {
      for (const item of uploadsRef.current[s]) {
        revoke(item);
        if (item.path) paths.push(item.path);
      }
    }
    if (paths.length) void getBrowserSupabase().storage.from(PHOTO_BUCKET).remove(paths);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    const id = randomId();
    draftIdRef.current = id;
    setDraftId(id);
    const fresh = emptyUploads();
    uploadsRef.current = fresh;
    setUploads(fresh);
    setValues(emptyValues(defaultCountry));
    setErrors({});
    setNotices({});
    setPendingError(undefined);
    setFormError(undefined);
    setStep(1);
    setFurthest(1);
    scrollTop();
  };

  if (!loaded) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-mute" role="status">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Loading your draft…
      </div>
    );
  }

  const stepsWithErrors = new Set<StepId>((Object.keys(errors) as SellField[]).map((k) => FIELD_STEP[k]));
  const current = STEPS[step - 1];

  return (
    <div ref={topRef} className="scroll-mt-20">
      <div className="mt-8 flex items-center justify-between gap-3">
        <p className="text-sm text-mute md:hidden">
          Step {step} of {STEPS.length}: <span className="font-semibold text-chalk">{current?.label}</span>
        </p>
        <p className="sr-only hidden md:block">
          Step {step} of {STEPS.length}: {current?.label}
        </p>
        <span className="hidden md:block" />
        <Button type="button" variant="ghost" size="sm" onClick={startOver} disabled={submitting}>
          <RotateCcw aria-hidden />
          Start over
        </Button>
      </div>
      <Progress step={step} furthest={furthest} onGo={goTo} />

      <form
        noValidate
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 5) void onSubmit();
          else onContinue();
        }}
      >
        {step === 1 ? <CarStep values={values} errors={errors} set={set} /> : null}
        {step === 2 ? <HistoryStep values={values} errors={errors} set={set} /> : null}
        {step === 3 ? (
          <PhotosStep
            uploads={uploads}
            restored={restored}
            errors={errors}
            notices={notices}
            pendingError={pendingError}
            videoUrl={values.videoUrl}
            onVideoUrl={(v) => set("videoUrl", v)}
            onAdd={addPhotos}
            onRemove={removePhoto}
            onRetry={retryPhoto}
            onMove={movePhoto}
          />
        ) : null}
        {step === 4 ? <PriceStep values={values} errors={errors} set={set} /> : null}
        {step === 5 ? (
          <ReviewStep
            values={values}
            photos={photos}
            errors={errors}
            stepsWithErrors={stepsWithErrors}
            onEdit={goTo}
            onConfirm={(v) => set("confirmed", v)}
          />
        ) : null}

        {formError ? (
          <p role="alert" className="mt-6 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm">
            {formError}
          </p>
        ) : null}

        <div data-sticky-bottom="sell" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-asphalt/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:mt-10 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="mx-auto flex max-w-3xl gap-3 md:justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onBack}
              disabled={step === 1 || submitting}
              className="flex-1 md:flex-none"
            >
              Back
            </Button>
            <Button type="submit" size="lg" disabled={submitting} className="flex-[2] md:flex-none">
              {step === 5 ? (
                submitting ? (
                  <>
                    <Loader2 aria-hidden className="animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit for review"
                )
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Progress({ step, furthest, onGo }: { step: StepId; furthest: StepId; onGo: (s: StepId) => void }) {
  return (
    <nav aria-label="Progress" className="mt-3">
      <div className="h-1 overflow-hidden rounded-full bg-line md:hidden">
        <div className="h-full bg-signal transition-[width]" style={{ width: `${(step / STEPS.length) * 100}%` }} />
      </div>
      <ol className="hidden gap-2 md:grid md:grid-cols-5">
        {STEPS.map((s) => {
          const isCurrent = s.id === step;
          const isDone = s.id < step || (s.id <= furthest && s.id !== step);
          const reachable = s.id <= furthest;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onGo(s.id)}
                disabled={!reachable || isCurrent}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex w-full flex-col gap-2 border-t-2 pt-2 text-left text-xs transition-colors",
                  isCurrent ? "border-signal text-chalk" : isDone ? "border-mute text-mute hover:text-chalk" : "border-line text-mute",
                  !reachable && "cursor-default opacity-60",
                )}
              >
                <span className="flex items-center gap-1.5 font-semibold">
                  {isDone ? <Check aria-hidden className="size-3.5 text-verified" /> : <span>{s.id}.</span>}
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

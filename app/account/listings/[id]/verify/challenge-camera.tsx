"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Camera, Check, Loader2, RefreshCw, X } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { CHALLENGE_MINUTES, NO_UPLOAD_NOTE, SHOTS, verificationFolder, type ChallengeShot } from "@/lib/listing-checks/challenge";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { startChallenge, submitChallenge } from "./actions";

const MAX_EDGE = 1600;
const ORDER: ChallengeShot[] = ["vin", "odometer"];

type Shot = { blob: Blob; url: string };

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow the camera for this site in your browser's settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found. Open this page on your phone and try again.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
  return "The camera couldn't start. Open this page on your phone and try again.";
}

/**
 * The live challenge: a code to write on a paper, then two photos taken with the camera
 * here (the rear camera on phones), with a framing guide and Retake. There's no file
 * input: the photos must be new (NO_UPLOAD_NOTE).
 */
export function ChallengeCamera({
  auctionId,
  userId,
  initialCode,
  initialExpiresAt,
  done,
}: {
  auctionId: string;
  userId: string;
  initialCode: string | null;
  initialExpiresAt: string | null;
  /** Both photos were already sent for this listing. */
  done: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [now, setNow] = useState(() => Date.now());
  const [active, setActive] = useState<ChallengeShot | null>(null);
  const [shots, setShots] = useState<Partial<Record<ChallengeShot, Shot>>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The video element mounts inside the dialog: give it the stream when it appears.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);
  const streamRef = useRef<MediaStream | null>(null);
  const takeRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const expired = !expiresAt || Date.parse(expiresAt) <= now;
  const minutesLeft = expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000)) : 0;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  async function newCode() {
    setBusy(true);
    setError(null);
    const r = await startChallenge({ auctionId });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCode(r.code ?? null);
    setExpiresAt(r.expiresAt ?? null);
    setNow(Date.now());
    // A new code needs new photos: the old ones show the old code.
    setShots({});
    setStatus(`New code ${r.code?.split("").join(" ")}. It's valid for ${CHALLENGE_MINUTES} minutes.`);
  }

  async function open(shot: ChallengeShot) {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't use the camera. Open this page on your phone and try again.");
      return;
    }
    try {
      stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setActive(shot);
    } catch (e) {
      setError(cameraError(e));
    }
  }

  async function take() {
    const video = videoRef.current;
    if (!video || !active || !video.videoWidth) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return setError("The photo couldn't be saved. Try again.");
    const shot = active;
    setShots((s) => {
      if (s[shot]) URL.revokeObjectURL(s[shot]!.url);
      return { ...s, [shot]: { blob, url: URL.createObjectURL(blob) } };
    });
    stop();
    setActive(null);
    setStatus(`${SHOTS[shot].title}: taken. Check it's sharp, then continue or retake it.`);
  }

  async function send() {
    if (!shots.vin || !shots.odometer) return;
    if (expired) return setError("The code has expired. Get a new code and take both photos again.");
    setBusy(true);
    setError(null);
    setStatus("Sending the photos…");
    const supabase = getBrowserSupabase();
    const folder = verificationFolder(userId, auctionId);
    const paths: Record<ChallengeShot, string> = { vin: "", odometer: "" };
    for (const shot of ORDER) {
      const path = `${folder}/challenge-${shot}-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("inspection-uploads").upload(path, shots[shot]!.blob, { contentType: "image/jpeg" });
      if (upErr) {
        setBusy(false);
        setStatus("");
        return setError("The photos didn't upload. Check your connection and try again.");
      }
      paths[shot] = path;
    }
    setStatus("Checking the photos… This takes up to a minute.");
    const r = await submitChallenge({ auctionId, vinPath: paths.vin, odometerPath: paths.odometer });
    setBusy(false);
    if (!r.ok) {
      setStatus("");
      setError(r.error);
      if (r.expired) setShots({});
      return;
    }
    setStatus(r.message);
    // Sent: a retry starts from a new code and new photos.
    setShots({});
    setCode(null);
    setExpiresAt(null);
    router.refresh();
  }

  const camera = active ? SHOTS[active] : null;
  return (
    <div className="space-y-4">
      <p className="rounded-md border border-line bg-asphalt/60 p-3 text-sm text-mute">{NO_UPLOAD_NOTE}</p>
      {done && !code ? <p className="text-sm text-verified">Both photos are sent. You can take them again with a new code if needed.</p> : null}

      {!code || expired ? (
        <div className="space-y-2">
          {code && expired ? <p className="text-sm font-semibold text-signal">Your code has expired. Get a new code to take the photos.</p> : null}
          <Button type="button" onClick={() => void newCode()} disabled={busy} className="min-h-12 w-full sm:w-auto">
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {code ? "Get a new code" : "Get a code"}
          </Button>
          <p className="text-xs text-mute">Do this at the car: the code is valid for {CHALLENGE_MINUTES} minutes.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-signal/50 bg-panel p-4">
          <p className="text-sm text-mute">Write this code on a paper, in large letters:</p>
          <p id={`${id}-code`} className="mt-1 font-mono text-4xl font-black tracking-[0.3em] text-chalk" aria-label={`Code: ${code.split("").join(" ")}`}>
            {code}
          </p>
          <p className="mt-1 text-xs text-mute">
            Valid until <LocalDateTime iso={expiresAt} /> ({minutesLeft} {minutesLeft === 1 ? "minute" : "minutes"} left).
          </p>
        </div>
      )}

      {code && !expired ? (
        <ol className="space-y-4">
          {ORDER.map((shot) => {
            const s = shots[shot];
            return (
              <li key={shot} className="rounded-lg border border-line bg-panel p-3">
                <h3 className="font-semibold">{SHOTS[shot].title}</h3>
                <p className="mt-1 text-sm text-mute">{SHOTS[shot].hint}</p>
                {s ? (
                  <div className="mt-3 space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (object URL) */}
                    <img src={s.url} alt={`Your photo: ${SHOTS[shot].title}`} className="max-h-64 w-full rounded-md object-contain" />
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => void open(shot)} disabled={busy || active !== null}>
                      <RefreshCw aria-hidden />
                      Retake<span className="sr-only"> {SHOTS[shot].title}</span>
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="mt-3 min-h-12 w-full sm:w-auto" onClick={() => void open(shot)} disabled={busy || active !== null}>
                    <Camera aria-hidden />
                    Open the camera<span className="sr-only"> for {SHOTS[shot].title}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}

      <DialogPrimitive.Root
        open={camera !== null}
        onOpenChange={(open) => {
          if (!open) {
            stop();
            setActive(null);
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            className="fixed inset-0 z-50 flex flex-col bg-black"
            aria-describedby={`${id}-guide`}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              takeRef.current?.focus();
            }}
          >
            <DialogPrimitive.Title className="sr-only">{camera ? `Camera: ${camera.title}` : "Camera"}</DialogPrimitive.Title>
            <div className="relative flex-1 overflow-hidden">
              <video ref={attachVideo} playsInline muted autoPlay className="size-full object-cover" aria-hidden />
              {/* Framing guide */}
              <div aria-hidden className="pointer-events-none absolute inset-[12%_8%] rounded-xl border-4 border-dashed border-signal/90" />
              <p id={`${id}-guide`} className="absolute inset-x-0 top-0 bg-black/70 p-3 text-center text-sm font-semibold text-white">
                {camera?.guide}. The code {code} must be readable.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 bg-black p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="outline" className="min-h-12 border-white/60 text-white">
                  <X aria-hidden />
                  Cancel
                </Button>
              </DialogPrimitive.Close>
              <Button ref={takeRef} type="button" size="lg" className="min-h-12" onClick={() => void take()}>
                <Camera aria-hidden />
                Take photo
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {code && !expired && shots.vin && shots.odometer ? (
        <Button type="button" size="lg" className="min-h-12 w-full sm:w-auto" onClick={() => void send()} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
          Send both photos
        </Button>
      ) : null}

      <p role="status" aria-live="polite" className="text-sm text-mute">
        {status}
      </p>
      {error ? (
        <div role="alert" className="space-y-1 text-sm text-signal">
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}

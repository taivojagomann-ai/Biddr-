"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBrowserSupabase } from "@/lib/supabase/client";

const WRONG = "That code is wrong or has expired. Check that your phone's clock is right, then try the newest code.";
const GENERIC = "Something went wrong. Check your connection and try again.";

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

/**
 * verify: a 6-digit code for the admin's existing authenticator.
 * enroll: shows a QR code and key for a new authenticator, then checks a code from it.
 */
export function TwoFactorForm({ mode, factorId, next }: { mode: "verify" | "enroll"; factorId: string | null; next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const started = useRef(false);

  // Set up a new authenticator once (a leftover unfinished one is removed first).
  useEffect(() => {
    if (mode !== "enroll" || started.current) return;
    started.current = true;
    const supabase = getBrowserSupabase();
    void (async () => {
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Biddr admin ${Date.now()}` });
      if (err || !data || data.type !== "totp") {
        setError("The authenticator setup couldn't start. Reload the page to try again.");
        return;
      }
      setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, [mode]);

  const activeFactor = mode === "verify" ? factorId : enrollment?.factorId ?? null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    if (!activeFactor) return;
    setBusy(true);
    setError(null);
    const { error: err } = await getBrowserSupabase().auth.mfa.challengeAndVerify({ factorId: activeFactor, code: token });
    if (err) {
      setBusy(false);
      setError(err.status === 429 ? "Too many attempts. Wait a minute, then try again." : err.status && err.status < 500 ? WRONG : GENERIC);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-6">
      {mode === "enroll" ? (
        <section aria-labelledby="enroll-heading" className="space-y-3 rounded-lg border border-line bg-panel p-4">
          <h2 id="enroll-heading" className="font-semibold">
            1. Add Biddr to your authenticator app
          </h2>
          {enrollment ? (
            <>
              <p className="text-sm text-mute">Scan this QR code with the app:</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL from Supabase */}
              <img src={enrollment.qr} alt="QR code to add Biddr to your authenticator app" width={176} height={176} className="rounded-md bg-white p-2" />
              <p className="text-sm text-mute">
                Or enter this key by hand:{" "}
                <code className="break-all font-mono text-sm text-chalk" data-testid="totp-secret">
                  {enrollment.secret}
                </code>
              </p>
            </>
          ) : error ? null : (
            <p role="status" className="flex items-center gap-2 text-sm text-mute">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Preparing…
            </p>
          )}
        </section>
      ) : null}

      <form onSubmit={submit} className="space-y-3" noValidate>
        <label htmlFor="totp-code" className="block text-sm font-semibold">
          {mode === "enroll" ? "2. Enter the 6-digit code the app shows" : "6-digit code"}
        </label>
        <Input
          id="totp-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "totp-error" : undefined}
          className="tabular text-lg tracking-widest"
          autoFocus
        />
        {error ? (
          <p id="totp-error" role="alert" className="text-sm text-signal">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !activeFactor}>
          {busy ? "Checking…" : "Verify and continue"}
        </Button>
      </form>
    </div>
  );
}

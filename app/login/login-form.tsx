"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBrowserSupabase } from "@/lib/supabase/client";

const RESEND_COOLDOWN_S = 60;

const TOO_MANY = "Too many attempts. Wait a minute, then try again.";
const WRONG_CODE = "That code is wrong or has expired. Check the latest email, or send a new code.";
const GENERIC = "Something went wrong. Check your connection and try again.";

function sendErrorMessage(error: AuthError): string {
  if (error.status === 429) return TOO_MANY;
  if (error.status === 400 && /email/i.test(error.message)) return "Enter a valid email address.";
  return GENERIC;
}

function callbackPath(next: string): string {
  return `/auth/callback?next=${encodeURIComponent(next)}`;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>(initialError);
  const [pending, setPending] = useState<"google" | "email" | "code" | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resendAt) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendAt]);

  const redirectTo = () => `${window.location.origin}${callbackPath(next)}`;

  async function signInWithGoogle() {
    setError(undefined);
    setPending("google");
    const { error: err } = await getBrowserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    // On success the browser navigates away; only failures land here.
    if (err) {
      setError(err.status === 429 ? TOO_MANY : "Google sign-in was cancelled or failed. Try again, or use your email instead.");
      setPending(null);
    }
  }

  async function sendLink(address: string): Promise<boolean> {
    setError(undefined);
    setPending("email");
    const { error: err } = await getBrowserSupabase().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
    });
    setPending(null);
    if (err) {
      setError(sendErrorMessage(err));
      return false;
    }
    const t = Date.now();
    setNow(t);
    setResendAt(t + RESEND_COOLDOWN_S * 1000);
    return true;
  }

  async function onEmailSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) {
      setError("Enter your email address.");
      return;
    }
    setEmail(address);
    if (await sendLink(address)) {
      setSentTo(address);
      setCode("");
    }
  }

  async function onCodeSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sentTo) return;
    const token = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setError(undefined);
    setPending("code");
    const { error: err } = await getBrowserSupabase().auth.verifyOtp({ email: sentTo, token, type: "email" });
    if (err) {
      setError(err.status === 429 ? TOO_MANY : WRONG_CODE);
      setPending(null);
      return;
    }
    // Keep the button disabled while the callback checks the profile and redirects.
    router.replace(callbackPath(next));
  }

  async function onResend() {
    if (!sentTo || cooldown > 0) return;
    if (await sendLink(sentTo)) setCode("");
  }

  function useDifferentEmail() {
    setSentTo(null);
    setCode("");
    setError(undefined);
  }

  const errorBox = error ? (
    <p id="login-error" role="alert" className="rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-chalk">
      {error}
    </p>
  ) : null;

  if (sentTo) {
    return (
      <div className="mt-8 space-y-5">
        <div className="rounded-lg border border-line bg-panel p-4">
          <h2 className="font-wide text-lg font-bold">Check your inbox</h2>
          <p id="otp-help" className="mt-1 text-sm text-mute">
            We sent a sign-in link and a 6-digit code to <span className="break-all text-chalk">{sentTo}</span>. Open
            the link on this device, or enter the code below.
          </p>
        </div>

        <form onSubmit={onCodeSubmit} className="space-y-3" noValidate>
          <label htmlFor="otp" className="block text-sm font-semibold">
            6-digit code
          </label>
          <Input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="font-mono text-lg tracking-[0.4em]"
            aria-describedby={error ? "otp-help login-error" : "otp-help"}
            aria-invalid={error ? true : undefined}
            autoFocus
          />
          {errorBox}
          <Button type="submit" className="w-full" disabled={pending !== null || code.length !== 6}>
            {pending === "code" ? "Signing in…" : "Sign in with code"}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button type="button" variant="ghost" size="sm" onClick={useDifferentEmail} disabled={pending !== null}>
            Use a different email
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResend}
            disabled={pending !== null || cooldown > 0}
          >
            {pending === "email" ? "Sending…" : cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={signInWithGoogle}
        disabled={pending !== null}
      >
        <GoogleIcon />
        {pending === "google" ? "Opening Google…" : "Continue with Google"}
      </Button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-mute">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={onEmailSubmit} className="space-y-3" noValidate>
        <label htmlFor="email" className="block text-sm font-semibold">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error && error !== initialError ? true : undefined}
          required
        />
        {errorBox}
        <Button type="submit" size="lg" className="w-full" disabled={pending !== null}>
          {pending === "email" ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
    </div>
  );
}

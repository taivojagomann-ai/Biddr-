"use client";
import { useCallback, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { AdminResult } from "@/lib/admin-schemas";
import { cn } from "@/lib/utils";

const NETWORK_ERROR: AdminResult = {
  ok: false,
  error: "We couldn't reach the server. Check your connection and try again.",
};

/** Runs a server action, tracks pending state and keeps the last result for <ActionMessage>. */
export function useAdminAction() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AdminResult | null>(null);

  const run = useCallback(async (action: (input: unknown) => Promise<AdminResult>, input: unknown): Promise<AdminResult> => {
    setPending(true);
    setResult(null);
    let res: AdminResult;
    try {
      res = await action(input);
    } catch {
      res = NETWORK_ERROR;
    }
    setResult(res);
    setPending(false);
    return res;
  }, []);

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  return { run, pending, result, setResult, fieldErrors };
}

export function ActionMessage({ result, className }: { result: AdminResult | null; className?: string }) {
  if (!result) return null;
  return result.ok ? (
    <p role="status" className={cn("flex items-start gap-2 text-sm text-verified", className)}>
      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
      {result.message}
    </p>
  ) : (
    <p role="alert" className={cn("flex items-start gap-2 text-sm text-signal", className)}>
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      {result.error}
    </p>
  );
}

export function FieldNote({ error, hint }: { error?: string; hint?: string }) {
  if (error) return <p className="text-xs font-medium text-signal">{error}</p>;
  if (hint) return <p className="text-xs text-mute">{hint}</p>;
  return null;
}

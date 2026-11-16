import { FileCheck, ShieldCheck, Wrench } from "lucide-react";
import { HISTORY_TEXT } from "@/lib/history-report";
import { ACCIDENT_REPAIRED, DEALER_INSPECTED } from "@/lib/inspection";
import { cn } from "@/lib/utils";

export function ReserveBadge({ hasReserve, reserveMet, className }: { hasReserve: boolean; reserveMet: boolean; className?: string }) {
  if (!hasReserve) {
    return (
      <span className={cn("rounded-sm bg-signal px-1.5 py-0.5 text-xs font-bold text-asphalt", className)}>
        No reserve
      </span>
    );
  }
  return (
    <span className={cn("rounded-sm border border-line bg-asphalt/80 px-1.5 py-0.5 text-xs text-mute", className)}>
      {reserveMet ? "Reserve met" : "Reserve"}
    </span>
  );
}

/** "Dealer inspected": only pass `dealer` for cars with an accepted authorised dealer report. */
export function InspectionBadge({ dealer, className }: { dealer: string | null; className?: string }) {
  if (!dealer) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-sm bg-verified/10 px-1.5 py-0.5 text-xs font-semibold text-verified", className)}
      title={`Inspected by ${dealer}`}
    >
      <ShieldCheck className="size-3.5" aria-hidden />
      {DEALER_INSPECTED}
    </span>
  );
}

/** "History report": only for cars whose carVertical report an admin accepted (0020). Text, not colour only. */
export function HistoryBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-xs font-semibold text-chalk", className)}>
      <FileCheck className="size-3.5 shrink-0" aria-hidden />
      {HISTORY_TEXT.badge}
    </span>
  );
}

/** Auctions that went live in the last 24 hours. Text, so it doesn't rely on colour. */
export function NewBadge({ className }: { className?: string }) {
  return (
    <span className={cn("rounded-sm bg-chalk px-1.5 py-0.5 text-xs font-bold text-asphalt", className)}>New</span>
  );
}

/** Neutral tag for listings created by the admin demo-data tools. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn("rounded-sm border border-field bg-asphalt/90 px-1.5 py-0.5 text-xs font-semibold text-chalk", className)}>
      Demo
    </span>
  );
}

/** "Accident repaired". `collapsible`: on auction cards narrower than 180px only the wrench shows (text stays for screen readers). */
export function RestoredBadge({ className, collapsible = false }: { className?: string; collapsible?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-xs text-mute", className)}
      title={collapsible ? ACCIDENT_REPAIRED : undefined}
    >
      <Wrench className="size-3.5 shrink-0" aria-hidden />
      <span className={collapsible ? "ac-collapse-text" : undefined}>{ACCIDENT_REPAIRED}</span>
    </span>
  );
}

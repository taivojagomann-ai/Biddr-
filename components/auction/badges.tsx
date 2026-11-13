import { ShieldCheck, Wrench } from "lucide-react";
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

export function InspectionBadge({ partner, compact = false, className }: { partner: string | null; compact?: boolean; className?: string }) {
  if (!partner) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-sm bg-verified/10 px-1.5 py-0.5 text-xs font-semibold text-verified", className)}
      title={`Inspected by ${partner}`}
    >
      <ShieldCheck className="size-3.5" aria-hidden />
      {compact ? "Partner verified" : `Verified by ${partner}`}
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

/** `collapsible`: on auction cards narrower than 180px only the wrench shows (text stays for screen readers). */
export function RestoredBadge({ className, collapsible = false }: { className?: string; collapsible?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-xs text-mute", className)}
      title={collapsible ? "Professionally restored" : undefined}
    >
      <Wrench className="size-3.5 shrink-0" aria-hidden />
      <span className={collapsible ? "ac-collapse-text" : undefined}>Professionally restored</span>
    </span>
  );
}

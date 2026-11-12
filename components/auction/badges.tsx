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

export function RestoredBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-xs text-mute", className)}>
      <Wrench className="size-3.5" aria-hidden />
      Professionally restored
    </span>
  );
}

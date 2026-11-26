import { Circle, CircleCheck, CircleDot, CircleX, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One icon per meaning, everywhere on Biddr (DECISIONS.md point 18). Decorative: the word
 * next to it carries the meaning. The waiting clock pulses gently, except for people who
 * prefer reduced motion.
 */
export type StatusKind = "not-added" | "added" | "waiting" | "passed" | "attention" | "failed";

const ICONS = { "not-added": Circle, added: CircleDot, waiting: Clock, passed: CircleCheck, attention: TriangleAlert, failed: CircleX } as const;

export const STATUS_TEXT_CLASS: Record<StatusKind, string> = {
  "not-added": "text-status-neutral",
  added: "text-status-neutral",
  waiting: "text-status-neutral",
  passed: "text-status-success",
  attention: "text-status-warning",
  failed: "text-status-danger",
};

/** Border and tint for a status box (passed is the only green one). */
export const STATUS_BOX_CLASS: Record<StatusKind, string> = {
  "not-added": "border-line bg-panel",
  added: "border-line bg-panel",
  waiting: "border-line bg-panel",
  passed: "border-status-success/60 bg-status-success/10",
  attention: "border-status-warning/60 bg-status-warning/10",
  failed: "border-status-danger/60 bg-status-danger/10",
};

export function StatusIcon({ kind, className, animate = false }: { kind: StatusKind; className?: string; animate?: boolean }) {
  const Icon = ICONS[kind];
  return (
    <Icon
      aria-hidden
      data-status-icon={kind}
      className={cn("shrink-0", STATUS_TEXT_CLASS[kind], kind === "added" && "fill-status-neutral/25", animate && kind === "waiting" && "motion-safe:animate-pulse", className)}
    />
  );
}

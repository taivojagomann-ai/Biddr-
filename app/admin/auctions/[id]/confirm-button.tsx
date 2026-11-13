"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A button that opens a dialog saying exactly what will happen, and only runs
 * `onConfirm` after the admin confirms. The dialog stays open on failure.
 */
export function ConfirmButton({
  label,
  ariaLabel,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled,
  confirmDisabled,
  onConfirm,
  children,
  variant = "outline",
  size,
  className,
}: {
  label: React.ReactNode;
  ariaLabel?: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<boolean>;
  children?: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size={size} disabled={disabled} className={className} aria-label={ariaLabel}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="pr-8">{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="mt-2 space-y-2 text-sm text-mute">{description}</div>
        </DialogDescription>
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || confirmDisabled}
            className={cn(destructive && "bg-[#b91c1c] text-chalk hover:bg-[#991b1b] active:bg-[#7f1d1d]")}
            onClick={async () => {
              setBusy(true);
              const ok = await onConfirm();
              setBusy(false);
              if (ok) setOpen(false);
            }}
          >
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

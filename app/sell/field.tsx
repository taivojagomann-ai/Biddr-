import type { SellField } from "@/lib/sell";
import { cn } from "@/lib/utils";

export function fieldId(field: SellField): string {
  return `sell-${field.replace(".", "-")}`;
}

/** Props that wire an input to its label, hint and error. */
export function fieldProps(field: SellField, error: string | undefined, hasHint = false) {
  const id = fieldId(field);
  const describedBy = [error ? `${id}-error` : null, hasHint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return { id, name: field, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy || undefined };
}

export function Field({
  field,
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  field: SellField;
  label: string;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const id = fieldId(field);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-mute">(optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-mute">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

export function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="text-xs font-medium text-signal">
      {error}
    </p>
  );
}

export function StepHeading({ title, intro }: { title: string; intro?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="font-wide text-xl font-bold">{title}</h2>
      {intro ? <p className="mt-1 text-sm text-mute">{intro}</p> : null}
    </div>
  );
}

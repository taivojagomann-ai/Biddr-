"use client";
import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIST_ITEM_MAX, LIST_MAX_ITEMS, emptyServiceRow, type ServiceRowInput } from "@/lib/listing-details";

/** Rows of month, mileage, work done and workshop. Every input has its own visible label. */
export function ServiceHistoryEditor({
  id,
  rows,
  onChange,
  error,
  hint,
  disabled,
}: {
  id: string;
  rows: ServiceRowInput[];
  onChange: (rows: ServiceRowInput[]) => void;
  error?: string;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  const list = rows.length ? rows : [emptyServiceRow()];
  const firstInputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAfter = useRef<number | null>(null);

  useEffect(() => {
    if (focusAfter.current === null) return;
    firstInputs.current[focusAfter.current]?.focus();
    focusAfter.current = null;
  });

  const set = (i: number, key: keyof ServiceRowInput, value: string) =>
    onChange(list.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const add = () => {
    focusAfter.current = list.length;
    onChange([...list, emptyServiceRow()]);
  };
  const remove = (i: number) => {
    const next = list.filter((_, j) => j !== i);
    focusAfter.current = Math.max(0, Math.min(i, next.length) - 1);
    onChange(next.length ? next : [emptyServiceRow()]);
  };

  return (
    <fieldset className="min-w-0" aria-describedby={[hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}>
      <legend className="text-sm font-semibold">
        Service history <span className="ml-1.5 font-normal text-mute">(optional)</span>
      </legend>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-mute">
          {hint}
        </p>
      ) : null}
      <ol className="mt-2 space-y-3">
        {list.map((r, i) => {
          const p = i === 0 ? id : `${id}-${i}`;
          const empty = !r.date && !r.mileage && !r.description && !r.workshop;
          return (
            <li key={i} className="rounded-md border border-line bg-asphalt/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-mute">Service {i + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  disabled={disabled || (list.length === 1 && empty)}
                >
                  <X aria-hidden />
                  Remove<span className="sr-only"> service {i + 1}</span>
                </Button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-[8rem_9rem_minmax(0,1fr)]">
                <div>
                  <label htmlFor={p} className="mb-1 block text-xs">Month</label>
                  <Input
                    id={p}
                    ref={(el) => {
                      firstInputs.current[i] = el;
                    }}
                    value={r.date}
                    onChange={(e) => set(i, "date", e.target.value.replace(/[^\d-]/g, "").slice(0, 7))}
                    placeholder="2024-05"
                    inputMode="numeric"
                    disabled={disabled}
                  />
                </div>
                <div>
                  <label htmlFor={`${p}-km`} className="mb-1 block text-xs">Mileage (km)</label>
                  <Input
                    id={`${p}-km`}
                    value={r.mileage}
                    onChange={(e) => set(i, "mileage", e.target.value.replace(/[^\d\s]/g, ""))}
                    placeholder="48 500"
                    inputMode="numeric"
                    disabled={disabled}
                  />
                </div>
                <div>
                  <label htmlFor={`${p}-work`} className="mb-1 block text-xs">What was done</label>
                  <Input
                    id={`${p}-work`}
                    value={r.description}
                    onChange={(e) => set(i, "description", e.target.value)}
                    maxLength={LIST_ITEM_MAX}
                    placeholder="Oil and filter service"
                    disabled={disabled}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor={`${p}-shop`} className="mb-1 block text-xs">
                    Workshop <span className="text-mute">(optional)</span>
                  </label>
                  <Input
                    id={`${p}-shop`}
                    value={r.workshop}
                    onChange={(e) => set(i, "workshop", e.target.value)}
                    maxLength={LIST_ITEM_MAX}
                    disabled={disabled}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={add} disabled={disabled || list.length >= LIST_MAX_ITEMS}>
        <Plus aria-hidden />
        Add service
      </Button>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-signal">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

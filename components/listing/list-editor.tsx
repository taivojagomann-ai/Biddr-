"use client";
import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIST_ITEM_MAX, LIST_MAX_ITEMS } from "@/lib/listing-details";
import { cn } from "@/lib/utils";

/**
 * An editable list of short text items: one input per item, a remove button per
 * row and an "Add" button. Keyboard-only friendly: adding focuses the new input,
 * removing focuses the neighbouring one. Empty rows are ignored when saving.
 */
export function ListEditor({
  id,
  label,
  itemNoun,
  hint,
  items,
  onChange,
  error,
  max = LIST_MAX_ITEMS,
  addLabel,
  placeholder,
  disabled,
  optional,
}: {
  /** id of the first input, so error handling can focus it */
  id: string;
  label: string;
  /** e.g. "highlight" -> "Highlight 2", "Remove highlight 2" */
  itemNoun: string;
  hint?: React.ReactNode;
  items: string[];
  onChange: (items: string[]) => void;
  error?: string;
  max?: number;
  addLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  optional?: boolean;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<number | null>(null);
  const rows = items.length ? items : [""];
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const noun = itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    inputs.current[target]?.focus();
  });

  const update = (i: number, value: string) => onChange(rows.map((v, j) => (j === i ? value : v)));
  const add = () => {
    focusAfter.current = rows.length;
    onChange([...rows, ""]);
  };
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    // Focus the row above (or the only row left), so keyboard users stay in the list.
    focusAfter.current = next.length ? Math.max(0, i - 1) : 0;
    onChange(next.length ? next : [""]);
  };

  return (
    <fieldset className="min-w-0" aria-describedby={[hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}>
      <legend className="text-sm font-semibold">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-mute">(optional)</span> : null}
      </legend>
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-mute">
          {hint}
        </p>
      ) : null}
      <ol className="mt-2 space-y-2">
        {rows.map((value, i) => {
          const inputId = i === 0 ? id : `${id}-${i}`;
          return (
            <li key={i} className="flex items-center gap-2">
              <label htmlFor={inputId} className="w-6 shrink-0 text-right text-xs tabular text-mute">
                <span className="sr-only">{noun} </span>
                {i + 1}
              </label>
              <Input
                id={inputId}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                value={value}
                onChange={(e) => update(i, e.target.value)}
                maxLength={LIST_ITEM_MAX}
                placeholder={i === 0 ? placeholder : undefined}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                className={cn(error && "border-signal")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${itemNoun} ${i + 1}`}
                onClick={() => remove(i)}
                disabled={disabled || (rows.length === 1 && value === "")}
              >
                <X aria-hidden />
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        ref={addRef}
        type="button"
        variant="outline"
        size="sm"
        className="ml-8 mt-2"
        onClick={add}
        disabled={disabled || rows.length >= max}
      >
        <Plus aria-hidden />
        {addLabel ?? `Add ${itemNoun}`}
      </Button>
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-signal">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

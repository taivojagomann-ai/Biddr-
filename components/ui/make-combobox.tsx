"use client";
import { Check } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { findMake, searchMakes } from "@/lib/data/car-makes";
import { cn } from "@/lib/utils";

export type MakeValue = { make: string; other: boolean };

/**
 * Car make picker: an ARIA 1.2 combobox (editable, list autocomplete).
 * - Empty and focused: the popular makes. Typing filters the whole list (case, accents
 *   and aliases ignored), up to 10 results, and the last option is always "Other: <text>".
 * - ↓/↑ move through the options, Enter chooses, Escape closes the list, Alt+↓ opens it.
 * - Typing a make's exact name or alias and leaving the field chooses that make.
 * The parent keeps { make, other }: other is true only when "Other" was chosen.
 */
export function MakeCombobox({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  placeholder = "Start typing, e.g. BMW",
}: {
  id: string;
  value: MakeValue;
  onChange: (v: MakeValue) => void;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [text, setText] = useState(value.make);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("");

  // A new value from outside (a restored draft, a reset form) replaces the text.
  useEffect(() => {
    setText(value.make);
  }, [value.make]);

  const typed = text.trim();
  const makes = useMemo(() => searchMakes(typed), [typed]);
  const options: { label: string; make: string; other: boolean }[] = [
    ...makes.map((m) => ({ label: m, make: m, other: false })),
    ...(typed ? [{ label: `Other: ${typed}`, make: typed, other: true }] : []),
  ];

  // The result count, announced once typing pauses.
  useEffect(() => {
    if (!open || !typed) {
      setStatus("");
      return;
    }
    const t = setTimeout(
      () =>
        setStatus(
          makes.length === 0
            ? `No makes found. Choose Other to use “${typed}”.`
            : `${makes.length} ${makes.length === 1 ? "make" : "makes"} found.`,
        ),
      500,
    );
    return () => clearTimeout(t);
  }, [open, typed, makes.length]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId is derived from listId
  }, [active]);

  function choose(o: { make: string; other: boolean }) {
    setText(o.make);
    onChange({ make: o.make, other: o.other });
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = options.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        if (!e.altKey) setActive(0);
      } else if (n) setActive((a) => (a + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (e.altKey) setOpen(false);
      else if (!open) {
        setOpen(true);
        setActive(n - 1);
      } else if (n) setActive((a) => (a <= 0 ? n - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && options[active]) {
        e.preventDefault(); // choose, don't submit the form
        choose(options[active]!);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  function onBlur() {
    setOpen(false);
    setActive(-1);
    if (value.other) return;
    // The exact name or an alias of a listed make ("skoda", "vw") counts as choosing it.
    const known = findMake(text);
    if (known && known !== value.make) {
      setText(known);
      onChange({ make: known, other: false });
    }
  }

  const expanded = open && options.length > 0;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        maxLength={40}
        placeholder={placeholder}
        value={text}
        // Opens on focus, except when the form moved focus here to show an error: the
        // list would cover the message. Typing, a click or ↓ opens it then.
        onFocus={() => {
          if (!invalid) setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          // Typing replaces any earlier choice; leaving the field or choosing an option sets it again.
          onChange({ make: e.target.value, other: false });
        }}
        className={cn(
          "flex h-10 w-full rounded-md border border-field bg-asphalt px-3 text-sm text-chalk placeholder:text-mute focus-visible:border-signal",
          "[@media(pointer:coarse)]:h-11",
        )}
      />
      <div hidden={!expanded} className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-line bg-panel shadow-xl">
        {!typed ? (
          <p aria-hidden className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-mute">
            Popular makes
          </p>
        ) : null}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={typed ? "Makes" : "Popular makes"}
          className="max-h-72 overflow-y-auto py-1"
        >
          {options.map((o, i) => {
            const selected = !o.other ? value.make === o.make && !value.other : value.other && value.make === o.make;
            return (
              <li
                key={`${o.other ? "other:" : ""}${o.make}`}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                // Keep focus in the input; choose on mouse down so blur doesn't close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseMove={() => setActive(i)}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 text-sm [@media(pointer:coarse)]:min-h-11",
                  i === active ? "bg-line text-chalk" : "text-chalk/90",
                  o.other && "border-t border-line italic",
                )}
              >
                <span>{o.label}</span>
                {selected ? <Check className="size-4 shrink-0 text-signal" aria-hidden /> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {status}
      </p>
    </div>
  );
}

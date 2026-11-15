"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { parseSearchQuery, SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH, SUGGEST_MIN_LENGTH } from "@/lib/search";
import type { SearchSuggestion } from "@/lib/types";

/**
 * Free-text search for the home page (ARIA combobox with a list of suggestions).
 * The query lives in the URL as ?q= and keeps the tab, country and history filters.
 */
export function AuctionSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQuery = parseSearchQuery(params.get("q") ?? undefined);
  const [, startTransition] = useTransition();

  const [value, setValue] = useState(urlQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const suggestTimer = useRef<ReturnType<typeof setTimeout>>();
  const suggestRequest = useRef(0);
  // The query this component last put in the URL, to tell our own changes from
  // outside ones (a "Clear search" link, the back button).
  const pushed = useRef(urlQuery);

  const id = useId();
  const inputId = `${id}-input`;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;

  useEffect(() => {
    if (urlQuery !== pushed.current) {
      pushed.current = urlQuery;
      setValue(urlQuery);
      setOpen(false);
    }
  }, [urlQuery]);

  useEffect(() => () => {
    clearTimeout(searchTimer.current);
    clearTimeout(suggestTimer.current);
  }, []);

  const search = useCallback(
    (raw: string) => {
      clearTimeout(searchTimer.current);
      const q = parseSearchQuery(raw);
      if (q === pushed.current) return;
      pushed.current = q;
      const next = new URLSearchParams(params.toString());
      next.delete("make"); // the old Make filter
      if (q) next.set("q", q);
      else next.delete("q");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );

  const loadSuggestions = (raw: string) => {
    clearTimeout(suggestTimer.current);
    const q = parseSearchQuery(raw);
    if (q.length < SUGGEST_MIN_LENGTH) {
      suggestRequest.current++;
      setSuggestions([]);
      setActive(-1);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      const request = ++suggestRequest.current;
      const { data } = await getBrowserSupabase()
        .rpc("search_suggestions", { p_query: q, p_limit: 6 })
        .returns<SearchSuggestion[]>();
      if (request !== suggestRequest.current) return; // an older answer arriving late
      setSuggestions(data ?? []);
      setActive(-1);
    }, 150);
  };

  const onChange = (next: string) => {
    setValue(next);
    setOpen(true);
    loadSuggestions(next);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => search(next), SEARCH_DEBOUNCE_MS);
  };

  const choose = (s: SearchSuggestion) => {
    setValue(s.label);
    setOpen(false);
    setActive(-1);
    search(s.label);
    inputRef.current?.focus();
  };

  const clear = () => {
    setValue("");
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
    suggestRequest.current++;
    search("");
    inputRef.current?.focus();
  };

  const expanded = open && suggestions.length > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (suggestions.length === 0) return;
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        if (!expanded) {
          setOpen(true);
          setActive(step === 1 ? 0 : suggestions.length - 1);
        } else {
          // Past either end the focus goes back to the text (-1), then wraps.
          setActive((i) => {
            const n = i + step;
            if (n < -1) return suggestions.length - 1;
            if (n >= suggestions.length) return -1;
            return n;
          });
        }
        return;
      }
      case "Enter": {
        e.preventDefault();
        const picked = expanded ? suggestions[active] : undefined;
        if (picked) choose(picked);
        else {
          setOpen(false);
          search(value);
        }
        return;
      }
      case "Escape":
        if (expanded) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (value) {
          e.preventDefault();
          clear();
        }
        return;
    }
  };

  return (
    <div role="search" className="relative w-full md:max-w-xl">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
        Search make, model or year
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={SEARCH_MAX_LENGTH}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder="e.g. RS6, 911 or 2019"
          className={cn(
            "h-11 w-full rounded-md border border-field bg-panel pl-9 text-base text-chalk placeholder:text-mute focus-visible:border-signal md:text-sm",
            value ? "pr-12" : "pr-3",
          )}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-0.5 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-mute hover:text-chalk"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-field bg-panel py-1 shadow-lg"
      >
        {suggestions.map((s, i) => (
          <li
            key={`${s.make}|${s.model ?? ""}|${s.variant ?? ""}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // Keep focus in the text field when a suggestion is clicked.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(s)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm",
              i === active ? "bg-chalk text-asphalt" : "text-chalk hover:bg-asphalt",
            )}
          >
            <span className="min-w-0 truncate">{s.label}</span>{" "}
            <span className={cn("tabular", i === active ? "text-asphalt" : "text-mute")}>
              ({s.listing_count}
              <span className="sr-only"> {s.listing_count === 1 ? "listing" : "listings"}</span>)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

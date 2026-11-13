"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Mail, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Share: the native share sheet where the device has one, otherwise a small menu
 * with Copy link and the networks' own share URLs.
 */
export function ShareButton({ path, title }: { path: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Same value on server and client (no hydration mismatch); the page origin fills in after mount.
  const [base, setBase] = useState((process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, ""));
  useEffect(() => {
    if (!base) setBase(window.location.origin);
  }, [base]);
  const url = `${base}${path}`;
  const text = `${title} on Biddr`;
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const networks = [
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
    { label: "X", href: `https://x.com/intent/tweet?text=${t}&url=${u}` },
  ];

  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function share() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        // The user closed the sheet: nothing to do. Anything else: fall back to the menu.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    setStatus("");
    setOpen((o) => !o);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    } catch {
      setStatus("Couldn't copy. Select the address bar and copy the link from there.");
    }
  }

  const item = "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-asphalt/60";
  return (
    <div ref={rootRef} className="relative inline-block">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => void share()}
      >
        <Share2 aria-hidden />
        Share
      </Button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-40 mt-2 w-60 rounded-lg border border-line bg-panel p-1 shadow-2xl max-sm:left-0 max-sm:right-auto"
      >
        <ul>
          <li>
            <button ref={firstRef} type="button" className={item} onClick={() => void copy()}>
              {status === "Link copied" ? <Check aria-hidden className="size-4 text-verified" /> : <Copy aria-hidden className="size-4" />}
              Copy link
            </button>
          </li>
          {networks.map((n) => (
            <li key={n.label}>
              <a href={n.href} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setOpen(false)}>
                <Share2 aria-hidden className="size-4" />
                {n.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
          <li>
            <a href={`mailto:?subject=${t}&body=${u}`} className={item} onClick={() => setOpen(false)}>
              <Mail aria-hidden className="size-4" />
              Email
            </a>
          </li>
        </ul>
        <p role="status" className={status ? "px-3 pb-2 pt-1 text-xs text-verified" : "sr-only"}>
          {status}
        </p>
      </div>
    </div>
  );
}

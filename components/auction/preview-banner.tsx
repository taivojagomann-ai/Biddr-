"use client";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PreviewBannerHandle {
  focusHeading: () => void;
}

/**
 * The banner above a listing preview: a region named by its heading, with a short
 * message and actions. When sticky it stays under the site header, and the page's
 * scroll padding grows with it so keyboard focus is never hidden behind it.
 */
export const PreviewBanner = forwardRef<
  PreviewBannerHandle,
  { heading: string; children?: ReactNode; actions?: ReactNode; sticky?: boolean; tone?: "info" | "warning" }
>(function PreviewBanner({ heading, children, actions, sticky = false, tone = "info" }, ref) {
  const id = useId();
  const headingId = `${id}-heading`;
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useImperativeHandle(ref, () => ({
    focusHeading: () => headingRef.current?.focus({ preventScroll: true }),
  }));

  useEffect(() => {
    const section = sectionRef.current;
    if (!sticky || !section) return;
    const header = document.querySelector<HTMLElement>("body > header, header");
    const html = document.documentElement;
    const before = html.style.scrollPaddingTop;
    const update = () => {
      const top = header?.getBoundingClientRect().height ?? 0;
      section.style.top = `${top}px`;
      html.style.scrollPaddingTop = `${top + section.getBoundingClientRect().height + 16}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(section);
    if (header) observer.observe(header);
    return () => {
      observer.disconnect();
      html.style.scrollPaddingTop = before;
    };
  }, [sticky]);

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      data-sticky-top={sticky ? "preview" : undefined}
      className={cn(
        "border-y",
        tone === "warning" ? "border-signal/60 bg-panel" : "border-field bg-panel",
        sticky ? "sticky z-30" : "rounded-md border-x",
      )}
    >
      <div className={cn("flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4", sticky ? "container" : "px-4")}>
        <div className="flex min-w-0 items-start gap-2">
          <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
          <div className="min-w-0">
            <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-sm font-bold outline-none">
              {heading}
            </h2>
            {children ? <div className="text-sm text-mute">{children}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </section>
  );
});

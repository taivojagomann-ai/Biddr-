"use client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Maximize2 } from "lucide-react";
import { PhotoViewer, type ViewerPhoto } from "@/components/auction/photo-viewer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Auction } from "@/lib/types";

type Section = { key: string; label: string; photos: string[] };

export function Gallery({ auction }: { auction: Auction }) {
  const sections: Section[] = [
    { key: "exterior", label: "Exterior", photos: auction.gallery_urls.exterior },
    { key: "interior", label: "Interior", photos: auction.gallery_urls.interior },
    { key: "mechanical", label: "Engine and underside", photos: auction.gallery_urls.mechanical },
    { key: "before", label: "Before repair", photos: auction.before_photos_urls },
  ].filter((s) => s.photos.length > 0);

  // A public, redacted copy of an accepted dealer report.
  const hasDocs = Boolean(auction.inspection_report_url) && auction.inspection_type === "authorised_dealer";
  const first = sections[0]?.key ?? (hasDocs ? "docs" : "exterior");

  // The large viewer goes through every section in order: Exterior, Interior, ...
  const viewerPhotos = useMemo<ViewerPhoto[]>(
    () =>
      sections.flatMap((s) =>
        s.photos.map((src, i) => ({ src, section: s.label, n: i + 1, total: s.photos.length, alt: photoAlt(auction.title, s.label, i, s.photos.length) })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sections is derived from these
    [auction.title, auction.gallery_urls, auction.before_photos_urls],
  );
  const offsets = useMemo(() => {
    const out: Record<string, number> = {};
    let n = 0;
    for (const s of sections) {
      out[s.key] = n;
      n += s.photos.length;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sections is derived from these
  }, [auction.gallery_urls, auction.before_photos_urls]);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pushedHash = useRef(false);

  const hashFor = (i: number) => `#photo-${i + 1}`;
  const withoutHash = () => window.location.pathname + window.location.search;

  const openViewer = useCallback((flatIndex: number, from: HTMLElement | null) => {
    opener.current = from;
    // A history entry, so the browser's or phone's back button closes the viewer.
    window.history.pushState(window.history.state, "", hashFor(flatIndex));
    pushedHash.current = true;
    setViewerIndex(flatIndex);
  }, []);

  const closeViewer = useCallback(() => {
    if (pushedHash.current) {
      window.history.back(); // popstate below closes it
    } else {
      window.history.replaceState(window.history.state, "", withoutHash());
      setViewerIndex(null);
    }
  }, []);

  const changeViewerIndex = useCallback((i: number) => {
    window.history.replaceState(window.history.state, "", hashFor(i));
    setViewerIndex(i);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (/^#photo-\d+$/.test(window.location.hash)) return;
      pushedHash.current = false;
      setViewerIndex(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Opened from a link with #photo-<n>: show that photo.
  useEffect(() => {
    const m = /^#photo-(\d+)$/.exec(window.location.hash);
    const n = m ? Number(m[1]) : 0;
    if (n >= 1 && n <= viewerPhotos.length) setViewerIndex(n - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the first render
  }, []);

  return (
    <Tabs defaultValue={first} className="w-full">
      <TabsList aria-label="Photo categories">
        {sections.map((s) => (
          <TabsTrigger key={s.key} value={s.key}>
            {s.label} <span className="ml-1 text-mute tabular">{s.photos.length}</span>
          </TabsTrigger>
        ))}
        {hasDocs && <TabsTrigger value="docs">Inspection documents</TabsTrigger>}
      </TabsList>

      {sections.map((s) => (
        <TabsContent key={s.key} value={s.key}>
          {s.key === "before" && (
            <p className="mb-3 rounded-md border border-line bg-panel px-3 py-2 text-sm text-mute">
              Photos of the damage before repair, supplied by the seller.
            </p>
          )}
          <PhotoStrip
            photos={s.photos}
            carTitle={auction.title}
            label={s.label}
            onOpen={(i, from) => openViewer(offsets[s.key]! + i, from)}
          />
        </TabsContent>
      ))}

      {hasDocs && (
        <TabsContent value="docs">
          <a
            href={auction.inspection_report_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-line bg-panel p-4 hover:border-mute"
          >
            <FileText className="size-8 text-verified" aria-hidden />
            <span>
              <span className="block font-semibold">Dealer inspection report (PDF)</span>
              <span className="text-sm text-mute">
                {auction.inspection_partner_name ?? "Authorised dealer"}
                {auction.inspection_date && `, ${new Date(auction.inspection_date).toLocaleDateString("en-GB")}`}
              </span>
            </span>
          </a>
        </TabsContent>
      )}

      {viewerIndex !== null && viewerPhotos[viewerIndex] ? (
        <PhotoViewer
          photos={viewerPhotos}
          index={viewerIndex}
          carTitle={auction.title}
          onIndexChange={changeViewerIndex}
          onClose={closeViewer}
          onCloseAutoFocus={() => opener.current?.focus({ preventScroll: true })}
        />
      ) : null}
    </Tabs>
  );
}

/** "<car>, <section>, photo <n> of <total>". */
function photoAlt(car: string, section: string, i: number, total: number) {
  return `${car}, ${section}, photo ${i + 1} of ${total}`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One section's photos: a native scroll-snap track (swipe on touch screens, with the
 * browser's own momentum and vertical page scrolling), arrows, a counter and thumbnails.
 */
function PhotoStrip({
  photos,
  carTitle,
  label,
  onOpen,
}: {
  photos: string[];
  carTitle: string;
  label: string;
  onOpen: (index: number, from: HTMLElement | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [announce, setAnnounce] = useState("");
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const many = photos.length > 1;

  const scrollToIndex = useCallback(
    (i: number) => {
      const track = trackRef.current;
      if (!track) return;
      const next = (i + photos.length) % photos.length;
      track.scrollTo({ left: next * track.clientWidth, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    },
    [photos.length],
  );

  // The photo in view follows the scroll position; the counter is announced once it stops.
  function onScroll() {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const i = Math.min(photos.length - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
    setIndex(i);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setAnnounce(`Photo ${i + 1} of ${photos.length}`), 250);
  }
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  // Keep the active thumbnail in view (without scrolling the page).
  useEffect(() => {
    const strip = thumbsRef.current;
    const thumb = strip?.querySelector<HTMLElement>(`[data-thumb="${index}"]`);
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft;
    const right = left + thumb.offsetWidth;
    if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: left - (strip.clientWidth - thumb.offsetWidth) / 2, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }, [index]);

  const slideEl = (i: number) => trackRef.current?.querySelector<HTMLElement>(`[data-slide="${i}"]`) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={`${label} photos`}
        tabIndex={0}
        data-gallery=""
        className="relative rounded-lg"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && many) scrollToIndex(index + 1);
          else if (e.key === "ArrowLeft" && many) scrollToIndex(index - 1);
          else if (e.key === "Enter" && e.target === e.currentTarget) onOpen(index, slideEl(index));
          else return;
          e.preventDefault();
        }}
      >
        <div
          ref={trackRef}
          onScroll={onScroll}
          data-gallery-track=""
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg bg-panel [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {photos.map((src, i) => (
            <div
              key={i}
              data-slide={i}
              role="group"
              aria-roledescription="slide"
              aria-label={`Photo ${i + 1} of ${photos.length}`}
              tabIndex={-1}
              className="relative aspect-[3/2] w-full shrink-0 snap-center snap-always cursor-zoom-in outline-none"
              onClick={(e) => onOpen(i, e.currentTarget)}
            >
              <Image
                src={src}
                alt={photoAlt(carTitle, label, i, photos.length)}
                fill
                draggable={false}
                priority={i === 0}
                loading={i === 0 ? undefined : Math.abs(i - index) <= 1 ? "eager" : "lazy"}
                sizes="(min-width: 1024px) 65vw, 100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>

        {many && (
          <>
            <button type="button" onClick={() => scrollToIndex(index - 1)} aria-label="Previous photo"
              className="absolute left-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-asphalt/80 hover:bg-asphalt [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:bg-asphalt/50">
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button type="button" onClick={() => scrollToIndex(index + 1)} aria-label="Next photo"
              className="absolute right-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-asphalt/80 hover:bg-asphalt [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:bg-asphalt/50">
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </>
        )}

        {/* Opens the large viewer: "Click to enlarge" with a mouse, an icon on touch screens. */}
        <button
          type="button"
          onClick={() => onOpen(index, slideEl(index))}
          className="absolute left-2 top-2 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-asphalt/80 px-3 text-xs font-semibold hover:bg-asphalt [@media(pointer:coarse)]:bg-asphalt/50 [@media(pointer:coarse)]:px-0"
        >
          <Maximize2 className="size-4" aria-hidden />
          <span className="[@media(pointer:coarse)]:hidden">Click to enlarge</span>
          <span className="sr-only hidden [@media(pointer:coarse)]:block">Enlarge photo</span>
        </button>

        {many && (
          <span aria-hidden data-gallery-counter="" className="pointer-events-none absolute bottom-2 right-2 rounded-sm bg-asphalt/80 px-2 py-0.5 text-xs tabular">
            {index + 1} / {photos.length}
          </span>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announce}
        </p>
      </div>

      {many && (
        <div ref={thumbsRef} data-gallery-thumbs="" className="relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {photos.map((src, i) => (
            <button key={i} type="button" data-thumb={i} onClick={() => scrollToIndex(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              className={cn("relative aspect-[3/2] w-24 shrink-0 overflow-hidden rounded-md border-2",
                i === index ? "border-signal" : "border-transparent opacity-70 hover:opacity-100")}>
              <Image src={src} alt="" fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

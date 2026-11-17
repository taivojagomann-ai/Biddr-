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

  // The full-screen viewer goes through every section in order: Exterior, Interior, ...
  const viewerPhotos = useMemo<ViewerPhoto[]>(
    () =>
      sections.flatMap((s) =>
        s.photos.map((src, i) => ({ src, section: s.label, n: i + 1, total: s.photos.length, alt: photoAlt(auction.title, s.label, i, s.photos.length) })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sections is derived from these
    [auction.title, auction.gallery_urls, auction.before_photos_urls],
  );
  const offsets: Record<string, number> = {};
  sections.reduce((n, s) => ((offsets[s.key] = n), n + s.photos.length), 0);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pushedHash = useRef(false);

  const openViewer = useCallback((flatIndex: number, from: HTMLElement | null) => {
    opener.current = from;
    // A history entry, so the browser's or phone's back button closes the viewer.
    window.history.pushState(window.history.state, "", `#photo-${flatIndex + 1}`);
    pushedHash.current = true;
    setViewerIndex(flatIndex);
  }, []);

  const closeViewer = useCallback(() => {
    if (pushedHash.current) {
      window.history.back(); // the popstate listener below closes it
    } else {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setViewerIndex(null);
    }
  }, []);

  const changeViewerIndex = useCallback((i: number) => {
    window.history.replaceState(window.history.state, "", `#photo-${i + 1}`);
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

  // Opened from a link ending in #photo-<n>: show that photo.
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
  const [index, setIndex] = useState(0);
  const photoRef = useRef<HTMLDivElement>(null);
  const go = useCallback((d: number) => setIndex((i) => (i + d + photos.length) % photos.length), [photos.length]);
  const current = photos[index];

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <div ref={photoRef} tabIndex={-1} data-gallery-photo="" className="relative aspect-[3/2] overflow-hidden rounded-lg bg-panel outline-none">
        {current && (
          // Clicking or tapping the photo opens the full-screen viewer (the
          // "Click to enlarge" button below does the same for keyboards and screen readers).
          <div className="absolute inset-0 cursor-zoom-in" onClick={() => onOpen(index, photoRef.current)}>
            <Image src={current} alt={photoAlt(carTitle, label, index, photos.length)} fill priority={index === 0} sizes="(min-width: 1024px) 65vw, 100vw" className="object-cover" />
          </div>
        )}
        <button
          type="button"
          onClick={() => onOpen(index, photoRef.current)}
          className="absolute left-2 top-2 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-asphalt/80 px-3 text-xs font-semibold hover:bg-asphalt [@media(pointer:coarse)]:bg-asphalt/60 [@media(pointer:coarse)]:px-0"
        >
          <Maximize2 className="size-4" aria-hidden />
          <span className="[@media(pointer:coarse)]:hidden">Click to enlarge</span>
          <span className="sr-only hidden [@media(pointer:coarse)]:block">Enlarge</span>
          <span className="sr-only">
            {" "}photo {index + 1} of {photos.length}
          </span>
        </button>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-asphalt/80 p-2.5 hover:bg-asphalt">
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-asphalt/80 p-2.5 hover:bg-asphalt">
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <span aria-hidden className="absolute bottom-2 right-2 rounded-sm bg-asphalt/80 px-2 py-0.5 text-xs tabular">
              {index + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {photos.map((src, i) => (
            <button key={i} type="button" onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}`}
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

"use client";
import Image from "next/image";
import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Auction } from "@/lib/types";

type Section = { key: string; label: string; photos: string[] };

export function Gallery({ auction }: { auction: Auction }) {
  const sections: Section[] = [
    { key: "exterior", label: "Exterior", photos: auction.gallery_urls.exterior },
    { key: "interior", label: "Interior", photos: auction.gallery_urls.interior },
    { key: "mechanical", label: "Engine and underside", photos: auction.gallery_urls.mechanical },
    { key: "before", label: "Before restoration", photos: auction.before_photos_urls },
  ].filter((s) => s.photos.length > 0);

  const hasDocs = Boolean(auction.inspection_report_url);
  const first = sections[0]?.key ?? (hasDocs ? "docs" : "exterior");

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
              Photos of the damage before repair, supplied by the seller and checked by the inspection partner.
            </p>
          )}
          <PhotoStrip photos={s.photos} alt={`${auction.title}, ${s.label.toLowerCase()}`} />
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
              <span className="block font-semibold">Inspection report (PDF)</span>
              <span className="text-sm text-mute">
                {auction.inspection_partner_name ?? "Partner workshop"}
                {auction.inspection_date && `, ${new Date(auction.inspection_date).toLocaleDateString("en-GB")}`}
              </span>
            </span>
          </a>
        </TabsContent>
      )}
    </Tabs>
  );
}

function PhotoStrip({ photos, alt }: { photos: string[]; alt: string }) {
  const [index, setIndex] = useState(0);
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
      <div className="relative aspect-[3/2] overflow-hidden rounded-lg bg-panel">
        {current && (
          <Image src={current} alt={`${alt}, photo ${index + 1} of ${photos.length}`} fill priority={index === 0}
            sizes="(min-width: 1024px) 65vw, 100vw" className="object-cover" />
        )}
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-asphalt/80 p-2 hover:bg-asphalt">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-asphalt/80 p-2 hover:bg-asphalt">
              <ChevronRight className="size-5" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-sm bg-asphalt/80 px-2 py-0.5 text-xs tabular">
              {index + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {photos.map((src, i) => (
            <button key={src} type="button" onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
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

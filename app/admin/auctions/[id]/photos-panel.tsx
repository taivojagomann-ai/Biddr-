"use client";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHOTO_SECTIONS, type PhotoSection } from "@/lib/sell";
import { makeCover, removePhoto } from "../../actions";
import { ActionMessage, useAdminAction } from "./action-feedback";
import { ConfirmButton } from "./confirm-button";

export function PhotosPanel({
  auctionId,
  photos,
}: {
  auctionId: string;
  photos: Record<PhotoSection, string[]>;
}) {
  const { run, pending, result } = useAdminAction();

  return (
    <div className="space-y-6">
      <ActionMessage result={result} />
      {PHOTO_SECTIONS.map((s) => {
        const list = photos[s.key];
        if (s.key === "before" && list.length === 0) return null;
        return (
          <div key={s.key}>
            <h3 className="text-sm font-semibold">
              {s.label} <span className="font-normal text-mute">({list.length})</span>
            </h3>
            {list.length === 0 ? (
              <p className="mt-2 text-sm text-mute">No photos.</p>
            ) : (
              <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {list.map((url, i) => (
                  <li key={url} className="overflow-hidden rounded-md border border-line bg-asphalt">
                    <a href={url} target="_blank" rel="noreferrer" className="relative block aspect-[4/3]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- many small admin thumbnails */}
                      <img src={url} alt={`${s.label} photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                      {s.key === "exterior" && i === 0 ? (
                        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-sm bg-signal px-1.5 py-0.5 text-[11px] font-bold text-asphalt">
                          <Star aria-hidden className="size-3" /> Cover
                        </span>
                      ) : null}
                    </a>
                    <div className="flex items-center justify-between gap-1 p-1">
                      {s.key === "exterior" && i > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => void run(makeCover, { auctionId, section: s.key, url })}
                        >
                          Make cover
                        </Button>
                      ) : (
                        <span />
                      )}
                      <ConfirmButton
                        label={<Trash2 aria-hidden />}
                        ariaLabel={`Remove ${s.label.toLowerCase()} photo ${i + 1}`}
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={pending}
                        title="Remove this photo?"
                        description={
                          <p>
                            It&apos;s taken off the listing and the file is deleted from storage, so the link stops
                            working. You can&apos;t undo this.
                          </p>
                        }
                        confirmLabel="Remove photo"
                        destructive
                        onConfirm={async () => (await run(removePhoto, { auctionId, section: s.key, url })).ok}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

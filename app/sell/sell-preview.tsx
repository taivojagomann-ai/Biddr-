"use client";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { AuctionView } from "@/components/auction/auction-view";
import { PreviewBanner, type PreviewBannerHandle } from "@/components/auction/preview-banner";
import { Button } from "@/components/ui/button";
import { PREVIEW_TEXT } from "@/lib/listing-preview";
import type { Auction } from "@/lib/types";

/**
 * Full-page preview of the listing being sold, built from the form's answers and the
 * already-uploaded photos. Same layout as /auctions/[id]; nothing is saved.
 */
export const SellPreview = forwardRef<
  PreviewBannerHandle,
  {
    auction: Auction | null;
    userId: string;
    initialNow: number;
    submitting: boolean;
    formError?: string;
    onBack: () => void;
    onSubmit: () => void;
  }
>(function SellPreview({ auction, userId, initialNow, submitting, formError, onBack, onSubmit }, ref) {
  return (
    <div className="pb-6">
      <PreviewBanner
        ref={ref}
        sticky
        heading={PREVIEW_TEXT.sellBanner}
        actions={
          <>
            <Button type="button" size="sm" variant="outline" onClick={onBack} disabled={submitting}>
              Back to edit
            </Button>
            {auction ? (
              <Button type="button" size="sm" onClick={onSubmit} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 aria-hidden className="animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit for review"
                )}
              </Button>
            ) : null}
          </>
        }
      >
        {formError ? (
          <p role="alert" className="mt-1 font-semibold text-signal">
            {formError}
          </p>
        ) : null}
      </PreviewBanner>

      <div className="container py-6">
        {auction ? (
          <AuctionView
            auction={auction}
            bids={[]}
            comments={[]}
            userId={userId}
            hasHold={false}
            canComment={false}
            watching={false}
            initialNow={initialNow}
            holdEur={0} // the hold text isn't shown in a preview
            preview
          />
        ) : (
          <div className="rounded-lg border border-dashed border-line p-8 text-center">
            <h1 className="font-wide text-2xl font-extrabold">Nothing to preview yet</h1>
            <p className="mt-2 text-sm text-mute">Some answers are missing or need fixing. Go back to the form to finish them.</p>
          </div>
        )}
      </div>
    </div>
  );
});

import { Check, Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Auction } from "@/lib/types";

export function InspectionCard({ auction }: { auction: Auction }) {
  if (!auction.inspection_partner_name) return null;
  const restored = auction.condition_type === "restored_accident";

  return (
    <section aria-labelledby="inspection-heading" className="rounded-lg border border-verified/30 bg-panel">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <ShieldCheck className="mt-0.5 size-6 shrink-0 text-verified" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="inspection-heading" className="font-bold">Partner verified</h2>
          <p className="text-sm text-mute">
            Inspected by {auction.inspection_partner_name}
            {auction.inspection_date && ` on ${new Date(auction.inspection_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}.
            The workshop is independent of the seller.
          </p>
        </div>
      </div>

      {restored && auction.damage_history_summary && (
        <div className="border-b border-line p-4">
          <h3 className="text-sm font-semibold">Accident and repair history</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-mute">{auction.damage_history_summary}</p>
        </div>
      )}

      {auction.inspection_highlights.length > 0 && (
        <ul className="grid gap-2 p-4 sm:grid-cols-2">
          {auction.inspection_highlights.map((h) => (
            <li key={h} className="flex gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-verified" aria-hidden />
              {h}
            </li>
          ))}
        </ul>
      )}

      {auction.inspection_report_url && (
        <div className="p-4 pt-0">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <a href={auction.inspection_report_url} target="_blank" rel="noopener noreferrer">
              <Download aria-hidden />
              Download full report (PDF)
            </a>
          </Button>
        </div>
      )}
    </section>
  );
}

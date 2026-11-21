import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { sellerSummary, type SellerVerificationView } from "@/lib/listing-checks/seller-status";
import { cn } from "@/lib/utils";

/** The listing's verification on My listings: one line and a link to the verify page. */
export function VerifyStatus({ auctionId, title, view }: { auctionId: string; title: string; view: SellerVerificationView }) {
  const s = sellerSummary(view);
  const Icon = s.tone === "ok" ? CheckCircle2 : s.tone === "bad" ? AlertTriangle : s.tone === "wait" ? Clock : ShieldCheck;
  return (
    <div
      data-verify-status={s.tone}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2.5 text-sm",
        s.tone === "ok" ? "border-verified/50" : s.tone === "bad" ? "border-signal/60 bg-signal/10" : s.tone === "todo" ? "border-signal/40" : "border-line",
      )}
    >
      <Icon aria-hidden className={cn("size-4 shrink-0", s.tone === "ok" ? "text-verified" : s.tone === "wait" ? "text-mute" : "text-signal")} />
      <span className="min-w-0 flex-1">{s.text}</span>
      <Link
        href={`/account/listings/${auctionId}/verify`}
        className="inline-flex min-h-11 items-center font-semibold text-chalk underline underline-offset-4 hover:text-signal"
      >
        {s.tone === "todo" || (s.tone === "bad" && view.canRetry) ? "Verify your car" : "Details"}
        <span className="sr-only">: {title}</span>
      </Link>
    </div>
  );
}

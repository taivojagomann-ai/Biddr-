import Link from "next/link";
import { STATUS_BOX_CLASS, StatusIcon, type StatusKind } from "@/components/status-icon";
import { verificationSummary, type VerificationModel } from "@/lib/listing-checks/verification-model";
import { cn } from "@/lib/utils";

const KIND = { todo: "not-added", checking: "waiting", passed: "passed", approved: "passed", attention: "attention", failed: "failed" } as const satisfies Record<string, StatusKind>;

/** The listing's verification on My listings: one line (icon and words) and a link to "Verify your car". */
export function VerifyStatus({ auctionId, title, model }: { auctionId: string; title: string; model: VerificationModel }) {
  const s = verificationSummary(model);
  const kind = KIND[s.status];
  const act = s.status === "todo" || s.status === "attention" || (s.status === "failed" && model.editable);
  return (
    <div data-verify-status={s.status} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2.5 text-sm", STATUS_BOX_CLASS[kind])}>
      <StatusIcon kind={kind} className="size-4" />
      <span className="min-w-0 flex-1">{s.text}</span>
      <Link
        href={`/account/listings/${auctionId}/verify`}
        className="inline-flex min-h-11 items-center font-semibold text-chalk underline underline-offset-4 hover:text-signal"
      >
        {act ? "Verify your car" : "Details"}
        <span className="sr-only"> for {title}</span>
      </Link>
    </div>
  );
}

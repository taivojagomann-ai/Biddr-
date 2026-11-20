"use client";
import { useRouter } from "next/navigation";
import { BiddingTermsForm } from "@/components/bidding-terms-form";

/** Contacting sellers needs the bidding terms accepted, as bidding does. */
export function TermsGate({ version, holdEur }: { version: string; holdEur: number }) {
  const router = useRouter();
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <BiddingTermsForm
        version={version}
        holdEur={holdEur}
        title={<h2 className="text-lg font-bold">Accept the bidding terms first</h2>}
        description={<p className="mt-1 text-sm text-mute">Contacting sellers needs the same acceptance as bidding. How bidding on Biddr works:</p>}
        onAccepted={() => router.refresh()}
        onRecheck={() => router.refresh()}
      />
    </section>
  );
}

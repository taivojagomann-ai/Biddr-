"use client";
import { FlaskConical } from "lucide-react";
import type { AdminResult } from "@/lib/admin-schemas";
import { ActionMessage, useAdminAction } from "./auctions/[id]/action-feedback";
import { ConfirmButton } from "./auctions/[id]/confirm-button";
import { loadDemoDataAction, removeDemoDataAction } from "./demo-actions";

export function DemoDataPanel({ demoAuctions }: { demoAuctions: number }) {
  const { run, pending, result } = useAdminAction();
  const hasDemo = demoAuctions > 0;
  const ok = async (action: () => Promise<AdminResult>) => (await run(() => action(), undefined)).ok;
  const dialogError = result && !result.ok ? <ActionMessage result={result} /> : null;

  return (
    <section aria-labelledby="demo-heading" className="mt-8 rounded-lg border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <FlaskConical aria-hidden className="mt-0.5 size-5 shrink-0 text-mute" />
        <div className="min-w-0 flex-1">
          <h2 id="demo-heading" className="font-wide text-lg font-bold">
            Demo data
          </h2>
          <p className="mt-1 text-sm text-mute">
            {hasDemo
              ? `${demoAuctions} demo ${demoAuctions === 1 ? "auction is" : "auctions are"} on the site, marked “Demo”. Bidding on them is turned off.`
              : "Fill the site with six example auctions in different stages, with bids, comments and placeholder photos."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <ConfirmButton
              label={hasDemo ? "Reset demo data" : "Load demo data"}
              variant="default"
              disabled={pending}
              title={hasDemo ? "Reset the demo data?" : "Load demo data?"}
              description={
                <>
                  {hasDemo ? <p>The current demo data is removed first, then created again with times relative to now.</p> : null}
                  <p>
                    This creates 1 demo seller and 5 demo bidders (emails ending in @biddr.invalid, no passwords), and six
                    public auctions marked “Demo”: three live, one scheduled, one sold and one that ended below its reserve.
                  </p>
                  <p>No real member, auction or payment is touched, and nothing is sent to Stripe. It takes up to a minute.</p>
                </>
              }
              confirmLabel={hasDemo ? "Reset demo data" : "Load demo data"}
              onConfirm={() => ok(loadDemoDataAction)}
            >
              {dialogError}
            </ConfirmButton>
            <ConfirmButton
              label="Remove demo data"
              disabled={pending || !hasDemo}
              destructive
              title="Remove all demo data?"
              description={
                <>
                  <p>
                    This deletes every demo auction with its bids and comments, the demo photos and reports, and the six demo
                    users. Comments real members left on demo auctions go too.
                  </p>
                  <p>Only rows marked as demo are removed. Real members and auctions stay as they are.</p>
                </>
              }
              confirmLabel="Remove demo data"
              onConfirm={() => ok(removeDemoDataAction)}
            >
              {dialogError}
            </ConfirmButton>
          </div>
          {pending ? (
            <p role="status" className="mt-3 text-sm text-mute">
              Working… this can take up to a minute.
            </p>
          ) : (
            <ActionMessage result={result} className="mt-3" />
          )}
        </div>
      </div>
    </section>
  );
}

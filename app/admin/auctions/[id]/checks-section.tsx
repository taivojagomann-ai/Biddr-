import type { SupabaseClient } from "@supabase/supabase-js";
import { LocalDateTime } from "@/components/local-date-time";
import { BUCKET, loadVerification, readyForChecks, type VerificationRow } from "@/lib/listing-checks/run";
import { formatUsd } from "@/lib/listing-checks/costs";
import { cn } from "@/lib/utils";
import { ChecksActions } from "./checks-panel";
import { STATUS_BOX_CLASS, STATUS_TEXT_CLASS, StatusIcon, type StatusKind } from "@/components/status-icon";

const SIGNED_SECONDS = 600;

const CHECK_LABELS: Record<string, string> = {
  code: "Code on the paper",
  vin: "VIN (plate, listing, certificate)",
  mileage: "Odometer",
  owner: "Owner on the certificate",
  appearance: "Colour and body type",
  images: "Reverse image search",
};
const OUTCOME_LABELS = { pending: "Not run yet", green: "Green", yellow: "Yellow: needs a check", red: "Red" } as const;
const OUTCOME_KIND = { pending: "waiting", green: "passed", yellow: "attention", red: "failed" } as const satisfies Record<string, StatusKind>;
const CHECK_KIND = { pass: "passed", warn: "attention", fail: "failed" } as const satisfies Record<string, StatusKind>;

type CheckRow = { run_id: string; check_name: string; status: "pass" | "warn" | "fail"; extracted: Record<string, unknown>; confidence: string | null; reason: string | null; checked_at: string };
type CostRow = { provider: string; model: string | null; input_tokens: number; output_tokens: number; units: number; cost_usd: number; created_at: string };

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (Array.isArray(v)) return v.length ? v.map(show).join(", ") : "–";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${show(x)}`).join("; ");
  return String(v);
}

async function signed(db: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_SECONDS);
  return data?.signedUrl ?? null;
}

/** The admin's view of the fake-listing checks (DECISIONS.md point 16): result, extracted values next to the photos, actions. */
export async function ChecksSection({ db, auctionId, status, sellerId }: { db: SupabaseClient; auctionId: string; status: string; sellerId: string }) {
  const [v, { data: seller }, { data: rows }, { data: costs }] = await Promise.all([
    loadVerification(db, auctionId),
    db
      .from("profiles")
      .select("identity_status, identity_verified_name, identity_document_country, identity_verified_at")
      .eq("id", sellerId)
      .maybeSingle<{ identity_status: string; identity_verified_name: string | null; identity_document_country: string | null; identity_verified_at: string | null }>(),
    db.from("listing_checks").select("run_id, check_name, status, extracted, confidence, reason, checked_at").eq("auction_id", auctionId).order("checked_at", { ascending: false }).limit(60).returns<CheckRow[]>(),
    db.from("listing_check_costs").select("provider, model, input_tokens, output_tokens, units, cost_usd, created_at").eq("auction_id", auctionId).order("created_at").returns<CostRow[]>(),
  ]);
  const latestRun = rows?.[0]?.run_id;
  const checks = (rows ?? []).filter((r) => r.run_id === latestRun);
  const totalCost = (costs ?? []).reduce((s, c) => s + Number(c.cost_usd), 0);
  const files = v as VerificationRow | null;
  const [vinUrl, odoUrl, docs] = await Promise.all([
    signed(db, files?.vin_photo_path ?? null),
    signed(db, files?.odometer_photo_path ?? null),
    Promise.all([...(files?.registration_paths ?? []), ...(files?.authorisation_paths ?? [])].map(async (p) => ({ path: p, url: await signed(db, p) }))),
  ]);
  const outcome = v?.outcome ?? "pending";

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-checks-outcome={outcome}
          className={cn("inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-semibold", STATUS_BOX_CLASS[OUTCOME_KIND[outcome]], STATUS_TEXT_CLASS[OUTCOME_KIND[outcome]])}
        >
          <StatusIcon kind={OUTCOME_KIND[outcome]} className="size-4" />
          {OUTCOME_LABELS[outcome]}
        </span>
        {v?.waiting_for_identity ? <span className="text-mute">Owner check waits for the seller&apos;s identity.</span> : null}
        {v?.on_hold ? <span className="font-semibold text-status-danger">On hold</span> : null}
        {v && v.red_count > 0 ? <span className="text-mute">Red results: {v.red_count}</span> : null}
        {v?.checked_at ? (
          <span className="text-mute">
            Checked <LocalDateTime iso={v.checked_at} />
          </span>
        ) : null}
      </div>
      {v?.override_at ? (
        <p className="rounded-md border border-line p-3">
          <span className="font-semibold">Overridden ({v.override_outcome}):</span> {v.override_reason}{" "}
          <span className="text-mute">
            (<LocalDateTime iso={v.override_at} />)
          </span>
        </p>
      ) : null}
      {v?.outcome_reasons.length && !v.override_at ? (
        <ul className="list-disc space-y-1 pl-5">
          {v.outcome_reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-mute">Seller&apos;s identity</dt>
          <dd className="font-semibold">
            {seller?.identity_status === "verified" ? "Verified" : seller?.identity_status === "pending" ? "In progress" : seller?.identity_status === "requires_input" ? "Needs another try" : "Not verified"}
          </dd>
        </div>
        {seller?.identity_status === "verified" ? (
          <div>
            <dt className="text-mute">Verified name</dt>
            <dd className="font-semibold">
              {seller.identity_verified_name ?? "–"} {seller.identity_document_country ? `(${seller.identity_document_country} document)` : ""}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-mute">Content approved</dt>
          <dd className="font-semibold">{v?.content_approved_at ? <LocalDateTime iso={v.content_approved_at} /> : "Not yet"}</dd>
        </div>
        <div>
          <dt className="text-mute">Seller is the owner</dt>
          <dd className="font-semibold">{v ? (v.seller_is_owner ? "Yes" : "No: authorisation uploaded") : "–"}</dd>
        </div>
      </dl>

      {checks.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left">
            <caption className="sr-only">Automated checks</caption>
            <thead className="text-xs text-mute">
              <tr>
                <th scope="col" className="py-1 pr-3">Check</th>
                <th scope="col" className="py-1 pr-3">Result</th>
                <th scope="col" className="py-1 pr-3">Values read</th>
                <th scope="col" className="py-1">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {checks.map((c) => (
                <tr key={c.check_name} data-check={c.check_name}>
                  <th scope="row" className="py-2 pr-3 align-top font-semibold">{CHECK_LABELS[c.check_name] ?? c.check_name}</th>
                  <td className={cn("py-2 pr-3 align-top font-semibold", STATUS_TEXT_CLASS[CHECK_KIND[c.status]])}>
                    <span className="inline-flex items-center gap-1.5">
                      <StatusIcon kind={CHECK_KIND[c.status]} className="size-4" />
                      {c.status === "pass" ? "Pass" : c.status === "fail" ? "Fail" : "Check"}
                    </span>
                    {c.confidence ? <span className="block text-xs font-normal text-mute">{c.confidence} confidence</span> : null}
                  </td>
                  <td className="break-words py-2 pr-3 align-top">{show(c.extracted)}</td>
                  <td className="py-2 align-top">{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-mute">
          {v?.files_purged_at
            ? "The photos and documents were deleted 30 days after the auction ended."
            : "The seller hasn't added the registration certificate and both photos yet."}
        </p>
      )}

      {vinUrl || odoUrl || docs.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["VIN plate with the code", vinUrl],
            ["Odometer with the code", odoUrl],
          ].map(([label, url]) =>
            url ? (
              <figure key={label}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL */}
                <img src={url} alt={`Seller's photo: ${label}`} className="max-h-72 w-full rounded-md border border-line object-contain" />
                <figcaption className="mt-1 text-xs text-mute">{label}</figcaption>
              </figure>
            ) : null,
          )}
          {docs.map((d, i) =>
            d.url ? (
              d.path.endsWith(".pdf") ? (
                <a key={d.path} href={d.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-signal">
                  {d.path.includes("/authorisation-") ? "Owner's authorisation" : "Registration certificate"} {i + 1} (PDF)<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <figure key={d.path}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL */}
                  <img src={d.url} alt={d.path.includes("/authorisation-") ? "Owner's authorisation" : "Registration certificate"} className="max-h-72 w-full rounded-md border border-line object-contain" />
                  <figcaption className="mt-1 text-xs text-mute">{d.path.includes("/authorisation-") ? "Owner's authorisation" : "Registration certificate"}</figcaption>
                </figure>
              )
            ) : null,
          )}
        </div>
      ) : null}

      {costs?.length ? (
        <details>
          <summary className="cursor-pointer text-mute">
            Estimated API cost: <span className="font-semibold text-chalk">{formatUsd(totalCost)}</span> ({costs.length} calls)
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-mute">
            {costs.map((c, i) => (
              <li key={i}>
                {c.provider === "anthropic" ? `${c.model}: ${c.input_tokens.toLocaleString("en-GB")} in / ${c.output_tokens.toLocaleString("en-GB")} out tokens` : `Google Vision: ${c.units} images`}
                , {formatUsd(Number(c.cost_usd))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {status === "draft" ? (
        <ChecksActions
          auctionId={auctionId}
          outcome={outcome}
          overridden={Boolean(v?.override_at)}
          contentApproved={Boolean(v?.content_approved_at)}
          canRerun={Boolean(v && readyForChecks(v))}
        />
      ) : null}
    </div>
  );
}

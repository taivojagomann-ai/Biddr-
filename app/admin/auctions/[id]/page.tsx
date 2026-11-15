import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck, ExternalLink, Mail, Phone } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { ADMIN_STATUS_LABELS, MAX_AUCTION_MS } from "@/lib/admin-schemas";
import { LocalDateTime } from "@/components/local-date-time";
import { COUNTRY_NAMES, formatEur, formatKm } from "@/lib/format";
import { REPORT_MAX_AGE_DAYS, daysSince, euCountryName } from "@/lib/sell";
import { COMMENT_COLUMNS, type Auction, type AuctionPrivate, type CommentRow, type Country } from "@/lib/types";
import { cn } from "@/lib/utils";
import { asServiceHistory, asTextList, toServiceRows } from "@/lib/listing-details";
import { CommentsPanel } from "./comments-panel";
import { DetailsForm } from "./details-form";
import { InspectionPanel, type DealerReportView } from "./inspection-panel";
import { WithdrawalRequest } from "./withdrawal-request";
import { ListingForm } from "./listing-form";
import { PhotosPanel } from "./photos-panel";
import { PricingForm } from "./pricing-form";
import { ScheduleForm } from "./schedule-form";
import { Section } from "./section";
import { StatusActions, type ApprovalCheck } from "./status-actions";

export const metadata: Metadata = { title: "Review auction" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SellerProfile = { username: string | null; full_name: string | null; phone: string | null; country: Country | null };
type BidRow = { id: string; amount: number; created_at: string; bidder: { username: string | null } | null };
type ActionRow = { id: string; action: string; created_at: string; admin: { username: string | null } | null };

const NAV = [
  ["status", "Status"],
  ["seller", "Seller"],
  ["listing", "Listing"],
  ["details", "Details"],
  ["photos", "Photos"],
  ["inspection", "Inspection"],
  ["pricing", "Pricing"],
  ["schedule", "Schedule"],
  ["bids", "Bids"],
  ["comments", "Comments"],
] as const;

/** What the inspection panel shows, with plain-language warnings for the admin. */
function dealerReportView(priv: AuctionPrivate | null, listingKm: number, startsAt: string | null): DealerReportView {
  const provided = priv?.dealer_inspection_provided ?? null;
  const paths = Array.isArray(priv?.dealer_report_paths) ? priv.dealer_report_paths : [];
  const dealer =
    provided && priv?.dealer_name && priv.dealer_inspection_date
      ? {
          name: priv.dealer_name,
          city: priv.dealer_city ?? "",
          country: euCountryName(priv.dealer_country) ?? priv.dealer_country ?? "",
          date: priv.dealer_inspection_date,
          mileageKm: priv.dealer_inspection_mileage_km,
        }
      : null;
  const warnings: string[] = [];
  if (dealer?.mileageKm != null && dealer.mileageKm > listingKm) {
    warnings.push(
      `The report shows ${dealer.mileageKm.toLocaleString("en-IE")} km, more than the ${listingKm.toLocaleString("en-IE")} km in the listing.`,
    );
  }
  if (dealer) {
    const start = startsAt ? new Date(startsAt) : new Date();
    const age = daysSince(dealer.date, start);
    if (age > REPORT_MAX_AGE_DAYS) {
      warnings.push(
        `The report is ${age} days old ${startsAt ? "at the scheduled start" : "today"}, more than ${REPORT_MAX_AGE_DAYS} days.`,
      );
    }
  }
  return {
    provided,
    dealer,
    files: paths.map((path, index) => ({
      index,
      label: `File ${index + 1} (${path.endsWith(".pdf") ? "PDF" : "image"})`,
    })),
    review: {
      status: priv?.inspection_review_status ?? null,
      note: priv?.inspection_review_note ?? null,
      reviewedAt: priv?.inspection_reviewed_at ?? null,
    },
    decision: {
      required: priv?.seller_decision_required ?? false,
      deadline: priv?.seller_decision_deadline ?? null,
      choice: priv?.seller_decision ?? null,
      at: priv?.seller_decision_at ?? null,
    },
    warnings,
  };
}

export default async function AdminAuctionPage({ params }: { params: { id: string } }) {
  const ctx = await requireAdmin();
  if (!ctx || !UUID_RE.test(params.id)) notFound();

  const { data: a } = await ctx.db.from("auctions").select("*").eq("id", params.id).maybeSingle<Auction>();
  if (!a) notFound();

  const [privRes, sellerRes, authRes, bidsRes, commentsRes, holdsRes, logRes] = await Promise.all([
    ctx.db.from("auction_private").select("*").eq("auction_id", a.id).maybeSingle<AuctionPrivate>(),
    ctx.db.from("profiles").select("username, full_name, phone, country").eq("id", a.seller_id).maybeSingle<SellerProfile>(),
    ctx.db.auth.admin.getUserById(a.seller_id),
    ctx.db
      .from("bids")
      .select("id, amount, created_at, bidder:profiles!bids_bidder_id_fkey(username)")
      .eq("auction_id", a.id)
      .order("created_at", { ascending: false })
      .returns<BidRow[]>(),
    ctx.db.from("comments").select(COMMENT_COLUMNS).eq("auction_id", a.id).order("created_at", { ascending: true }).returns<CommentRow[]>(),
    ctx.db.from("bid_holds").select("id", { count: "exact", head: true }).eq("auction_id", a.id).in("status", ["pending", "authorized"]),
    ctx.db
      .from("admin_actions")
      .select("id, action, created_at, admin:profiles!admin_actions_admin_id_fkey(username)")
      .eq("auction_id", a.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<ActionRow[]>(),
  ]);

  const priv = privRes.data;
  // null: submitted before sellers could choose (0013).
  const report = dealerReportView(priv, a.mileage_km, a.starts_at);
  const inspectionLabel =
    report.provided === true
      ? `Report provided · ${report.review.status === "accepted" ? "accepted" : report.review.status === "rejected" ? "rejected" : "waiting for review"}`
      : report.provided === false
        ? "No report: listed without an inspection"
        : "No report (submitted before dealer inspections)";
  const seller = sellerRes.data;
  const email = authRes.data.user?.email ?? null;
  const bids = bidsRes.data ?? [];
  const comments = commentsRes.data ?? [];
  const log = logRes.data ?? [];
  const restored = a.condition_type === "restored_accident";
  const now = Date.now();
  const isPublic = a.status !== "draft" && a.status !== "rejected";

  const checks: ApprovalCheck[] = [
    { label: "Start and end time saved", done: Boolean(a.starts_at && a.ends_at) },
    { label: "End time is in the future", done: Boolean(a.ends_at && Date.parse(a.ends_at) > now) },
    {
      label: "Runs 7 days or less",
      done: Boolean(a.starts_at && a.ends_at && Date.parse(a.ends_at) - Date.parse(a.starts_at) <= MAX_AUCTION_MS),
    },
    { label: "Has a cover photo", done: (a.gallery_urls.exterior ?? []).length > 0 },
  ];

  const pricingMode = a.status === "draft" || a.status === "upcoming" ? "full" : a.status === "live" ? "reserve-only" : "closed";

  return (
    <main className="container max-w-5xl py-8 sm:py-10">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-mute hover:text-chalk">
        <ArrowLeft aria-hidden className="size-4" /> All auctions
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-wide text-2xl font-extrabold tracking-tight sm:text-3xl">{a.title}</h1>
          <p className="mt-1 text-sm text-mute">
            {restored ? "Accident repaired" : "Clean history"} · {formatKm(a.mileage_km)} · {a.location_city},{" "}
            {COUNTRY_NAMES[a.location_country]} · Submitted <LocalDateTime iso={a.created_at} />
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "rounded-sm border px-2 py-1 text-xs font-semibold",
              a.status === "live" ? "border-signal text-signal" : a.status === "draft" ? "border-mute text-chalk" : "border-line text-mute",
            )}
          >
            {ADMIN_STATUS_LABELS[a.status]}
          </span>
          {isPublic ? (
            <Link href={`/auctions/${a.id}`} className="inline-flex items-center gap-1 text-sm text-mute hover:text-chalk">
              Public page <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>

      {priv?.withdraw_request_status && (priv.withdraw_request_status === "pending" || a.status === "withdrawn" || a.status === "live") ? (
        <WithdrawalRequest
          auctionId={a.id}
          status={priv.withdraw_request_status}
          reason={priv.withdraw_reason}
          requestedAt={priv.withdraw_requested_at}
          bidCount={a.bid_count}
          holdCount={holdsRes.count ?? 0}
        />
      ) : null}
      {priv?.withdraw_reason && !priv.withdraw_request_status && a.status === "withdrawn" ? (
        <p className="mt-4 rounded-md border border-field px-3 py-2 text-sm">
          <span className="font-semibold">Withdrawn by the seller: </span>
          {priv.withdraw_reason}
        </p>
      ) : null}
      <p
        className={cn(
          "mt-4 inline-flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm",
          report.review.status === "pending" ? "border-signal/60" : report.review.status === "accepted" ? "border-verified/60" : "border-field",
        )}
      >
        <ClipboardCheck
          aria-hidden
          className={cn("size-4 shrink-0", report.review.status === "accepted" ? "text-verified" : report.review.status === "pending" ? "text-signal" : "text-mute")}
        />
        <span className="font-semibold">Dealer inspection:</span>
        <span>{inspectionLabel}</span>
        {report.provided ? (
          <a href="#inspection" className="underline underline-offset-4 hover:text-signal">
            Review it
          </a>
        ) : null}
      </p>

      <nav aria-label="Sections" className="mt-6">
        <ul className="flex flex-wrap gap-1 text-sm">
          {NAV.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex min-h-9 items-center rounded-md px-2.5 text-mute hover:bg-panel hover:text-chalk [@media(pointer:coarse)]:min-h-11">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 space-y-6">
        <Section id="status" title="Status" className="border-mute">
          <StatusActions
            auctionId={a.id}
            status={a.status}
            startsAt={a.starts_at}
            endsAt={a.ends_at}
            checks={checks}
            bidCount={a.bid_count}
            currentBid={a.current_bid}
            holdCount={holdsRes.count ?? 0}
            rejectionReason={priv?.rejection_reason ?? null}
            waitingForSeller={priv?.seller_decision_required ? (priv.seller_decision_deadline ?? null) : null}
          />
        </Section>

        <Section id="seller" title="Seller">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item label="Username" value={seller?.username} />
            <Item label="Full name" value={seller?.full_name} />
            <Item
              label="Email"
              value={
                email ? (
                  <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 break-all underline underline-offset-4 hover:text-signal">
                    <Mail aria-hidden className="size-3.5 shrink-0" />
                    {email}
                  </a>
                ) : null
              }
            />
            <Item
              label="Phone"
              value={
                seller?.phone ? (
                  <a href={`tel:${seller.phone}`} className="inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-signal">
                    <Phone aria-hidden className="size-3.5 shrink-0" />
                    {seller.phone}
                  </a>
                ) : null
              }
            />
            <Item label="Country" value={seller?.country ? COUNTRY_NAMES[seller.country] : null} />
            <Item label="Requested reserve" value={priv?.requested_reserve ? formatEur(priv.requested_reserve) : "No reserve"} />
            <Item label="Dealer inspection" value={inspectionLabel} />
          </dl>
        </Section>

        <Section id="listing" title="Listing">
          <ListingForm
            auctionId={a.id}
            vin={a.vin}
            restored={restored}
            initial={{
              title: a.title,
              variant: a.variant ?? "",
              engine: a.engine ?? "",
              transmission: a.transmission ?? "",
              drivetrain: a.drivetrain === "AWD" || a.drivetrain === "FWD" ? a.drivetrain : "RWD",
              exteriorColor: a.exterior_color ?? "",
              mileageKm: String(a.mileage_km),
              city: a.location_city,
              country: a.location_country,
              damageSummary: a.damage_history_summary ?? "",
              videoUrl: a.video_url ?? "",
              bodyStyle: a.body_style ?? "",
              interiorColor: a.interior_color ?? "",
              ownerCount: a.owner_count ? String(a.owner_count) : "",
              sellerType: a.seller_type === "dealer" ? "dealer" : "private",
              dealerName: a.dealer_name ?? "",
              dealerRegistryCode: a.dealer_registry_code ?? "",
              registrationCountry: a.registration_country ?? "",
              isRegistered: a.is_registered === null || a.is_registered === undefined ? "" : a.is_registered ? "yes" : "no",
            }}
          />
        </Section>

        <Section
          id="details"
          title="Details"
          intro="Highlights, equipment, modifications, known flaws, service history, items included and seller notes."
        >
          <DetailsForm
            auctionId={a.id}
            initial={{
              highlights: withBlank(asTextList(a.highlights)),
              equipment: withBlank(asTextList(a.equipment)),
              modifications: withBlank(asTextList(a.modifications)),
              noModifications: Boolean(a.no_modifications),
              knownFlaws: withBlank(asTextList(a.known_flaws)),
              noKnownFlaws: Boolean(a.no_known_flaws),
              serviceHistory: toServiceRows(asServiceHistory(a.service_history)),
              itemsIncluded: withBlank(asTextList(a.items_included)),
              sellerNotes: a.seller_notes ?? "",
            }}
          />
        </Section>

        <Section id="photos" title="Photos" intro="The first exterior photo is the cover in the feed and on the auction page.">
          <PhotosPanel
            auctionId={a.id}
            photos={{
              exterior: a.gallery_urls.exterior ?? [],
              interior: a.gallery_urls.interior ?? [],
              mechanical: a.gallery_urls.mechanical ?? [],
              before: a.before_photos_urls ?? [],
            }}
          />
        </Section>

        <Section
          id="inspection"
          title="Inspection"
          intro="Only reports from an authorised dealer of the car's brand, in an EU country, are accepted. Accepting adds the Dealer inspected badge."
        >
          <InspectionPanel
            auctionId={a.id}
            reviewable={a.status === "draft" || a.status === "upcoming"}
            report={report}
            listingMileage={formatKm(a.mileage_km)}
            initialHighlights={a.inspection_type === "authorised_dealer" ? (a.inspection_highlights ?? []) : []}
            reportUrl={a.inspection_report_url}
            sellerIsDealer={a.seller_type === "dealer"}
            initialInspectedBySeller={priv?.inspected_by_seller ?? false}
          />
        </Section>

        <Section id="pricing" title="Pricing">
          <PricingForm
            auctionId={a.id}
            mode={pricingMode}
            requestedReserve={priv?.requested_reserve ?? null}
            initial={{
              startingBid: a.starting_bid,
              minIncrement: a.min_bid_increment,
              reserve: priv?.reserve_price ?? null,
              hasReserve: a.has_reserve,
            }}
          />
        </Section>

        <Section id="schedule" title="Schedule" intro="Times are in your own time zone and stored in UTC.">
          {a.status === "draft" || a.status === "upcoming" ? (
            <ScheduleForm auctionId={a.id} startsAt={a.starts_at} endsAt={a.ends_at} />
          ) : (
            <p className="text-sm text-mute">
              <LocalDateTime iso={a.starts_at} /> to <LocalDateTime iso={a.ends_at} />.
              {a.status === "live" ? " Use Extend end time under Status to give bidders more time." : ""}
            </p>
          )}
        </Section>

        <Section id="bids" title={`Bids (${bids.length})`}>
          {bids.length === 0 ? (
            <p className="text-sm text-mute">No bids.</p>
          ) : (
            <ol className="divide-y divide-line text-sm">
              {bids.map((b, i) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span className={cn("min-w-0 truncate", i === 0 && "font-semibold text-signal")}>{b.bidder?.username ?? "Bidder"}</span>
                  <span className="flex shrink-0 items-baseline gap-4">
                    <time dateTime={b.created_at} className="text-xs text-mute tabular">
                      <LocalDateTime iso={b.created_at} />
                    </time>
                    <span className="font-semibold tabular">{formatEur(b.amount)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section id="comments" title={`Comments (${comments.length})`} intro="Delete spam, abuse or posts that share contact details.">
          <CommentsPanel auctionId={a.id} comments={comments} now={now} />
        </Section>

        <Section id="activity" title="Admin activity" intro="The last 20 admin changes to this auction.">
          {log.length === 0 ? (
            <p className="text-sm text-mute">No changes yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-3">
                  <time dateTime={l.created_at} className="text-mute tabular">
                    <LocalDateTime iso={l.created_at} />
                  </time>
                  <span>{l.admin?.username ?? "Admin"}</span>
                  <span className="font-mono text-xs text-mute">{l.action}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}

const withBlank = (list: string[]) => (list.length ? list : [""]);

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-mute">{label}</dt>
      <dd className="mt-0.5 break-words">{value || <span className="text-mute">Not given</span>}</dd>
    </div>
  );
}

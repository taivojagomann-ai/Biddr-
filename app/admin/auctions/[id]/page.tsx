import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, Phone } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { ADMIN_STATUS_LABELS, MAX_AUCTION_MS } from "@/lib/admin-schemas";
import { formatBaltic } from "@/lib/baltic-time";
import { COUNTRY_NAMES, formatEur, formatExactTime, formatKm } from "@/lib/format";
import { COMMENT_COLUMNS, type Auction, type AuctionPrivate, type CommentRow, type Country } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CommentsPanel } from "./comments-panel";
import { InspectionPanel } from "./inspection-panel";
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
  ["photos", "Photos"],
  ["inspection", "Inspection"],
  ["pricing", "Pricing"],
  ["schedule", "Schedule"],
  ["bids", "Bids"],
  ["comments", "Comments"],
] as const;

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
    ...(restored
      ? [
          { label: "Inspection partner added (restored car)", done: Boolean(a.inspection_partner_name) },
          { label: "Inspection report PDF attached (restored car)", done: Boolean(a.inspection_report_url) },
        ]
      : []),
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
            {restored ? "Restored after accident damage" : "Clean history"} · {formatKm(a.mileage_km)} · {a.location_city},{" "}
            {COUNTRY_NAMES[a.location_country]} · Submitted {formatExactTime(a.created_at, "Europe/Tallinn")}
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
            restored={restored}
            startsAt={a.starts_at}
            endsAt={a.ends_at}
            checks={checks}
            bidCount={a.bid_count}
            currentBid={a.current_bid}
            holdCount={holdsRes.count ?? 0}
            rejectionReason={priv?.rejection_reason ?? null}
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
            <Item label="Inspection city" value={priv?.inspection_city} />
            <Item label="Preferred inspection dates" value={priv?.inspection_preferred_dates} />
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
          intro={restored ? "Required before approval: this is a restored car." : "Optional for clean cars, but bidders trust inspected cars more."}
        >
          <InspectionPanel
            auctionId={a.id}
            restored={restored}
            reportUrl={a.inspection_report_url}
            initial={{
              partnerName: a.inspection_partner_name ?? "",
              inspectionDate: a.inspection_date ?? "",
              highlights: a.inspection_highlights ?? [],
            }}
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

        <Section id="schedule" title="Schedule" intro="Times are Baltic time (Tallinn, Riga, Vilnius) and stored in UTC.">
          {a.status === "draft" || a.status === "upcoming" ? (
            <ScheduleForm auctionId={a.id} startsAt={a.starts_at} endsAt={a.ends_at} />
          ) : (
            <p className="text-sm text-mute">
              {formatBaltic(a.starts_at)} to {formatBaltic(a.ends_at)}.
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
                      {formatExactTime(b.created_at, "Europe/Tallinn")}
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
                    {formatExactTime(l.created_at, "Europe/Tallinn")}
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

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-mute">{label}</dt>
      <dd className="mt-0.5 break-words">{value || <span className="text-mute">Not given</span>}</dd>
    </div>
  );
}

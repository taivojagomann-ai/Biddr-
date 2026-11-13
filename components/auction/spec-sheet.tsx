import { COUNTRY_NAMES, formatKm } from "@/lib/format";
import { BODY_STYLES, REGISTRATION_OPTIONS, labelOf } from "@/lib/listing-details";
import type { Auction } from "@/lib/types";

function registration(a: Auction): string | null {
  const where = labelOf(REGISTRATION_OPTIONS, a.registration_country);
  if (!where && a.is_registered === null) return null;
  const status = a.is_registered === true ? "registered" : a.is_registered === false ? "not registered right now" : null;
  return [where, status].filter(Boolean).join(", ") || null;
}

export function SpecSheet({ auction }: { auction: Auction }) {
  const rows: [string, string | null][] = [
    ["VIN", auction.vin],
    ["Mileage", formatKm(auction.mileage_km)],
    ["Engine", auction.engine],
    ["Transmission", auction.transmission],
    ["Drivetrain", auction.drivetrain],
    ["Body style", labelOf(BODY_STYLES, auction.body_style)],
    ["Colour", auction.exterior_color],
    ["Interior", auction.interior_color],
    ["Location", `${auction.location_city}, ${COUNTRY_NAMES[auction.location_country]}`],
    ["History", auction.condition_type === "clean" ? "Clean, no recorded accidents" : "Accident damage, professionally restored"],
    ["Owners", auction.owner_count ? String(auction.owner_count) : null],
    ["Seller", auction.seller_type === "dealer" ? (auction.dealer_name ? `Dealer: ${auction.dealer_name}` : "Dealer") : "Private seller"],
    ["Registration", registration(auction)],
  ];

  const visible = rows.filter((r): r is [string, string] => Boolean(r[1]));

  return (
    <section aria-labelledby="specs-heading">
      <h2 id="specs-heading" className="mb-3 text-lg font-bold">Specifications</h2>
      <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
        {visible.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 bg-panel px-4 py-3 text-sm">
            <dt className="text-mute">{label}</dt>
            <dd className={label === "VIN" ? "break-all text-right font-semibold tracking-wide" : "text-right font-semibold"}>{value}</dd>
          </div>
        ))}
        {visible.length % 2 === 1 && <div aria-hidden className="hidden bg-panel sm:block" />}
      </dl>
    </section>
  );
}

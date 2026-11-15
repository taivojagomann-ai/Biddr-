import { MapPin } from "lucide-react";
import { COUNTRY_NAMES, formatKm } from "@/lib/format";
import { DEALER_INSPECTED, NOT_INSPECTED, isDealerInspected } from "@/lib/inspection";
import { BODY_STYLES, REGISTRATION_LABELS, labelOf } from "@/lib/listing-details";
import type { Auction } from "@/lib/types";

function registration(a: Auction): string | null {
  const where = labelOf(REGISTRATION_LABELS, a.registration_country);
  if (!where && a.is_registered === null) return null;
  const status = a.is_registered === true ? "registered" : a.is_registered === false ? "not registered right now" : null;
  return [where, status].filter(Boolean).join(", ") || null;
}

/**
 * A Google Maps search for the city and country only, never a street address
 * (DECISIONS.md point 10). No embedded map: a link is enough.
 */
export function mapsSearchUrl(city: string, country: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${city}, ${country}`)}`;
}

function Location({ city, country }: { city: string; country: string }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
      <span>
        {city}, {country}
      </span>
      <a
        href={mapsSearchUrl(city, country)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-6 items-center gap-1 font-normal text-mute underline underline-offset-4 hover:text-chalk"
      >
        <MapPin aria-hidden className="size-3.5" />
        View on map<span className="sr-only"> (opens Google Maps in a new tab)</span>
      </a>
    </span>
  );
}

export function SpecSheet({ auction }: { auction: Auction }) {
  const country = COUNTRY_NAMES[auction.location_country];
  const rows: [string, React.ReactNode][] = [
    ["VIN", auction.vin],
    ["Mileage", formatKm(auction.mileage_km)],
    ["Engine", auction.engine],
    ["Transmission", auction.transmission],
    ["Drivetrain", auction.drivetrain],
    ["Body style", labelOf(BODY_STYLES, auction.body_style)],
    ["Colour", auction.exterior_color],
    ["Interior", auction.interior_color],
    ["Location", <Location key="location" city={auction.location_city} country={country} />],
    ["History", auction.condition_type === "clean" ? "Clean, no recorded accidents" : "Accident damage, repaired"],
    ["Owners", auction.owner_count ? String(auction.owner_count) : null],
    ["Seller", auction.seller_type === "dealer" ? (auction.dealer_name ? `Dealer: ${auction.dealer_name}` : "Dealer") : "Private seller"],
    ["Registration", registration(auction)],
    ["Inspection", isDealerInspected(auction) ? DEALER_INSPECTED : NOT_INSPECTED],
  ];

  const visible = rows.filter((r) => Boolean(r[1]));

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

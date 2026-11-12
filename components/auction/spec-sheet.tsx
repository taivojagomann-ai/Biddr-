import { COUNTRY_NAMES, formatKm } from "@/lib/format";
import type { Auction } from "@/lib/types";

export function SpecSheet({ auction }: { auction: Auction }) {
  const rows: [string, string | null][] = [
    ["VIN", auction.vin],
    ["Mileage", formatKm(auction.mileage_km)],
    ["Engine", auction.engine],
    ["Transmission", auction.transmission],
    ["Drivetrain", auction.drivetrain],
    ["Colour", auction.exterior_color],
    ["Location", `${auction.location_city}, ${COUNTRY_NAMES[auction.location_country]}`],
    ["History", auction.condition_type === "clean" ? "Clean, no recorded accidents" : "Accident damage, professionally restored"],
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

/**
 * Standard VAT rates of the EU countries (percent), for the buyer's premium.
 * Biddr's premium is an intermediary service to a private person, taxed where the
 * brokered sale takes place, i.e. where the car is (EU VAT Directive art. 46,
 * Estonian VAT Act § 10). The premium includes VAT. To be confirmed by Biddr's
 * accountant; check these rates whenever a country changes its standard rate.
 * Last checked: November 2026.
 */
export const VAT_RATES: Readonly<Record<string, number>> = {
  AT: 20, BE: 21, BG: 20, HR: 25, CY: 19, CZ: 21, DK: 25, EE: 24, FI: 25.5, FR: 20, DE: 19, GR: 24, HU: 27,
  IE: 23, IT: 22, LV: 21, LT: 21, LU: 17, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SK: 23, SI: 22, ES: 21, SE: 25,
};

/** The VAT rate for a car in this country; Estonia's if the country is unknown. */
export function vatRateFor(country: string | null | undefined): { country: string; rate: number } {
  const c = (country ?? "").toUpperCase();
  return c in VAT_RATES ? { country: c, rate: VAT_RATES[c]! } : { country: "EE", rate: VAT_RATES.EE! };
}

/** Splits a VAT-inclusive amount (cents) into net and VAT, rounding VAT to the cent. */
export function splitVat(totalCents: number, rate: number): { netCents: number; vatCents: number } {
  const netCents = Math.round((totalCents * 100) / (100 + rate));
  return { netCents, vatCents: totalCents - netCents };
}

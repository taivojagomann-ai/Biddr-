// The 27 EU countries Biddr serves (DECISIONS.md, point 2). No imports, so every
// module (types, server, client) can use it.

export const EU_COUNTRIES = [
  { code: "AT", name: "Austria" }, { code: "BE", name: "Belgium" }, { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" }, { code: "CY", name: "Cyprus" }, { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" }, { code: "EE", name: "Estonia" }, { code: "FI", name: "Finland" },
  { code: "FR", name: "France" }, { code: "DE", name: "Germany" }, { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" }, { code: "IE", name: "Ireland" }, { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" }, { code: "LT", name: "Lithuania" }, { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" }, { code: "NL", name: "Netherlands" }, { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" }, { code: "RO", name: "Romania" }, { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" }, { code: "ES", name: "Spain" }, { code: "SE", name: "Sweden" },
] as const;

export type EuCountry = (typeof EU_COUNTRIES)[number]["code"];

export const EU_CODES = EU_COUNTRIES.map((c) => c.code) as [EuCountry, ...EuCountry[]];

export const COUNTRY_NAMES = Object.fromEntries(EU_COUNTRIES.map((c) => [c.code, c.name])) as Record<EuCountry, string>;

export function isEuCountry(v: unknown): v is EuCountry {
  return typeof v === "string" && (EU_CODES as readonly string[]).includes(v);
}

export function euCountryName(code: string | null | undefined): string | null {
  return isEuCountry(code) ? COUNTRY_NAMES[code] : null;
}

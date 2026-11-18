/**
 * Biddr's legal details, printed on every invoice. PLACEHOLDERS for the sandbox:
 * replace the registry code, VAT number, address and email with the real ones
 * before switching to live payments. Issued invoices keep the details they were
 * issued with, so a change here only affects new invoices.
 */
export const COMPANY = {
  name: "Biddr OÜ",
  registryCode: "1111111",
  vatNumber: "2222222",
  addressLines: ["Testimise puiestee 5", "Tallinn", "Estonia"],
  email: "invoice@biddr.org",
} as const;

/** The country Biddr is established in (for VAT). */
export const COMPANY_COUNTRY = "EE";

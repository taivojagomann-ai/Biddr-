# Consistency review

A review of the whole site (code, UI copy, metadata, notifications, demo data, admin, README, How it works, legal placeholders, info tips) against [DECISIONS.md](DECISIONS.md). Every contradiction found is listed with what changed. Points refer to DECISIONS.md.

Method: searched the codebase for the forbidden phrases in points 2, 3, 4 and 8, for "seller fee" and "[to be confirmed]", and for every number in point 5. Then read every user-facing page and component, including empty states, errors, notifications, metadata, OG images, admin screens and demo data, and checked the logic behind them (filters, approval rules, stored values, time handling).

## Contradictions found and fixed

### Point 2: market is all 27 EU countries

| Where | Before | After |
| --- | --- | --- |
| Database type for countries (`baltic_country`, used by `profiles.country` and `auctions.location_country`) | Only EE, LV, LT. Sellers and bidders from other EU countries couldn't complete a profile or list a car. | Migration `0018_eu_countries.sql` adds the other 24 EU countries. |
| `lib/types.ts` (`Country`, `RegistrationCountry`) | `"EE" \| "LV" \| "LT"` | Any EU country (`lib/countries.ts`, the single list of 27). |
| Profile form (`lib/profile.ts`, `app/account/setup/actions.ts`) | Country: Estonia, Latvia, Lithuania | All 27 EU countries, alphabetical, validated against the same list. |
| Sell form, Car step (`lib/sell.ts`) and admin listing form (`lib/admin-schemas.ts`) | Car location: Estonia, Latvia, Lithuania | All 27 EU countries. |
| Registration country (`lib/listing-details.ts`, DB check `auctions_registration_country_check`) | Estonia, Latvia, Lithuania, "Another EU country", "Outside the EU" | Every EU country by name, plus "Outside the EU". Old "Another EU country" values still display. |
| `lib/format.ts` `COUNTRY_NAMES` | Three Baltic names | All 27 EU names. |
| Home page country check (`app/page.tsx`) | Only EE/LV/LT accepted in `?country=` | Any EU country. |
| Demo data (`lib/demo/seed.ts`) | Audi RS3 registered in "other_eu" | Registered in Finland ("FI"). |
| Profile phone hint and placeholder | "+372 5123 4567" (Estonian example) | "+49 151 2345 6789" |
| README | "Baltic time", inspection cities Tallinn/Riga/Vilnius | Removed (see point 7 and point 3 rows). |

### Point 9: country filter lists only countries with listings

| Where | Before | After |
| --- | --- | --- |
| Home filters (`components/auction/auction-filters.tsx`, `app/page.tsx`) | Always listed every country in `COUNTRY_NAMES` | Lists only countries with scheduled, live or finished listings (plus the selected one, so it never disappears while selected). |
| Featured block (`components/auction/featured-lot.tsx`) | Labelled "Closing next" | "Ending next" (still only on the Live tab without search or filters). |

### Point 7: time in the viewer's own zone, no "Baltic time"

| Where | Before | After |
| --- | --- | --- |
| `lib/baltic-time.ts` | All conversions and displays fixed to `Europe/Tallinn` | Removed. `lib/zoned-time.ts` converts and formats in a given zone, with the abbreviation ("Fri, 13 Nov 2026, 20:00 CET"). |
| Viewer's zone | None | `hooks/use-time-zone.ts` (UTC during server render and hydration, then the browser's zone) and `components/local-date-time.tsx` for server-rendered pages. |
| Exact-time tooltips (`lib/format.ts`, `components/relative-time.tsx`) | "13 Nov 2026, 14:32" with a manual " UTC" before hydration | Includes the zone abbreviation ("14:32 CET"). |
| Notifications (`lib/notifications.ts`, bell and list) | "Bidding starts …" and the decision deadline in Baltic time | In the viewer's zone, with the abbreviation. |
| Admin auction page | "Times are Eastern European time"; submitted, bid and activity times fixed to Tallinn | "Times are in your own time zone and stored in UTC"; every time in the admin's zone. |
| Admin schedule form | "Start (Eastern European time)" / "End (Eastern European time)"; inputs in Tallinn time | "Start (CET, your time zone)" etc.; inputs in the admin's zone, sent with the zone to the server, stored in UTC. |
| Admin Extend end time, approve dialog, waiting-for-seller deadline, live/scheduled summaries | "…, Eastern European time" | The admin's zone with its abbreviation; the custom end time is entered in the admin's zone. |
| Admin server messages ("Schedule saved…", "The auction now ends…", "Approved. Bidding opens…") | "…, Eastern European time" | Formatted in the admin's zone, which the browser sends. |
| Admin list, withdrawal request time, inspection review times | Fixed to `Europe/Tallinn` | Viewer's zone. |
| Profile ("Bidding terms accepted on …"), My listings ("Submitted …"), seller decision deadline | Fixed to Tallinn, or to the server's zone | Viewer's zone. |
| Demo loader | "tomorrow 12:00 … are Baltic time" | Schedules in a named demo zone (internal only; visitors see their own zone). |

### Point 11: things that don't exist

| Where | Before | After |
| --- | --- | --- |
| Sell form, Price step (`app/sell/price-step.tsx`) | "Seller fee: [to be confirmed]" | Removed. |
| Sell form, Review step (`app/sell/review-step.tsx`) | Row "Seller fee: [to be confirmed]" | Removed. |
| How it works, How selling works | "Seller fee: [to be confirmed]." | Removed. |
| How it works, After you win | "We contact you and the seller to arrange payment of the car and the buyer's premium, and the handover." | "We put you in touch with the seller: you pay for the car directly to the seller and arrange the handover with them. Biddr only charges the buyer's premium, and your €500 hold goes toward it." |
| Terms (`app/terms/page.tsx`) | "Our terms of use is coming soon." (not marked as a draft) | "Draft. Final text will be provided before launch." note and a "[Terms of use to be written with a lawyer]" placeholder, styled like Bidding terms. |
| Privacy (`app/privacy/page.tsx`) | "Our privacy notice is coming soon." | Same draft note and "[Privacy policy to be written with a lawyer]" placeholder. |

### Point 10: seller information

| Where | Before | After |
| --- | --- | --- |
| Auction page and listing previews | Only "Seller: Private seller / Dealer: name" in the specifications | New **Seller** card (`components/auction/seller-card.tsx`): username, country, member since, private seller or dealer with company name and registry code, and "N cars listed, M sold". Only public columns are read (`lib/seller-info.ts`); full name, phone and email are never shown. The sell preview shows the same card. |

### Points 3, 4 and 8: inspections, badges and names

| Where | Before | After |
| --- | --- | --- |
| README account menu | "Profile, Selling, Watchlist, Notifications, Sign out" | "Profile, My listings, Watchlist, Notifications, Sign out" |
| README, Dealer inspections | "Booking an inspection with a Biddr partner in Tallinn, Riga or Vilnius was removed" | "An earlier inspection-booking feature was removed" |
| README | "Listings that showed "Partner verified" before 0014…" | "Listings with an inspection from before 0014…" |
| README roadmap | "inspection city (Tallinn, Riga, Vilnius) stored in auction_private.inspection_city" | Removed. |
| README demo dealers | "Demo BMW Centre, Tallinn", "Demo Audi Centre, Riga" | "Demo BMW Centre", "Demo Audi Centre" |
| `supabase/migrations/0013_optional_inspections.sql` (a comment) | "next to "Restored, partner verified"" | "next to the existing restored filter" (comment only, no SQL change). |

Checked and already consistent: the badges "Dealer inspected" / "Inspected by the selling dealer" / "Accident repaired", the "Inspection" spec row, info tips, the sell form's dealer report question and its 90-day rule, the admin checklist, the 30-day seller decision, approval not needing an inspection, no code reading `inspection_city`/`inspection_requested`, and no notification types for removed features.

### Point 5: bidding numbers

Every text takes the numbers from one place (`lib/pricing.ts`: 5%, €350, €3,500; `BID_HOLD_AMOUNT_EUR`, default €500; 2-minute extension; 7-day maximum). Binding bids, 18+, own-car and demo rules are worded the same in the bid dialog, How it works and the errors. One wording fix:

| Where | Before | After |
| --- | --- | --- |
| How it works intro | "Biddr runs week-long online auctions." (sounds like exactly 7 days) | "Biddr runs online auctions of up to 7 days." |

### Other

- **Tests**: updated for "Ending next" and the new deadline format. New tests check the seller card (no full name or phone), the country filter, 27 EU countries in the profile, no seller fee, legal draft notes, no "Baltic" in the title, and the admin time zone label. The words "Partner verified" and "Professionally restored" appear in tests only to check that no page shows them.
- **DECISIONS.md** saved in the repo root.

## Needs a decision

1. **Currency.** All prices, holds and premiums are in euros. The market is now all 27 EU countries, including ones that don't use the euro (e.g. Poland, Sweden, Czechia). Nothing contradicts the decisions as written, but say whether euros only is intended.
2. **Hold amount comes from configuration.** The texts show the hold that is actually charged (`BID_HOLD_AMOUNT_EUR`, default €500). If that setting were changed, the site would show the new amount rather than €500. Keep it configurable, or fix it at €500?
3. **What "stats" means on the seller card.** I used "N cars listed, M sold" (listed counts scheduled, live and finished auctions). Other possibilities: sell-through rate, total sold value, or ratings (which don't exist).
4. **Default page title.** It is "Biddr: Cars worth chasing" (no mention of the Baltics, so it meets point 2). DECISIONS.md suggests "Biddr: enthusiast car auctions" as an example. Kept as is unless you prefer the example.
5. **Internal names.** The database type is still called `baltic_country`, and old unused columns (`inspection_city`, `inspection_requested`, `inspection_preferred_dates`) remain because nothing may be dropped. None of this is shown to users; renaming the type would mean re-creating every function that uses it.
6. **Sign-in emails.** Sign-in sends a magic link and code by email (Supabase Auth). That isn't a notification, so it doesn't conflict with point 11, but before launch it needs custom SMTP (see the README).

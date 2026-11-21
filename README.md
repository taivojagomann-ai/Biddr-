# Biddr (MVP, phase 1)

Rare finds. Brought back to life. Ready for a new story.

Online auctions for cars worth chasing, restored cars especially. The line above is the site's positioning: the home page intro, the default meta description and the home page link preview all use it (`SITE_INTRO` in `lib/site.ts`).


## Architecture

```
Browser (Next.js client components)
  │  reads: Supabase anon key + RLS          writes: place_bid RPC, comments insert
  │  live:  one Realtime channel per page     (auctions UPDATE, comments INSERT)
  ▼
Next.js on Vercel
  ├─ Server Components: initial render of feed + auction page (RLS as the user)
  ├─ /api/stripe/hold          create or resume the €500 manual-capture hold
  ├─ /api/stripe/hold/confirm  re-read PaymentIntent from Stripe, record hold
  ├─ /api/stripe/webhook       backstop for the above + cancel/fail/capture events
  └─ /api/stripe/release       Vercel Cron: release losers' holds on closed auctions
  ▼
Supabase Postgres (source of truth)
  ├─ place_bid(): SELECT … FOR UPDATE, all validation, anti-sniping, reserve check
  ├─ advance_auction_states(): pg_cron every minute (upcoming→live, live→sold/ended/reserve_not_met)
  ├─ server_time(): clients compute a clock offset; countdowns are display-only
  └─ RLS + column grants: reserve price, phone, Stripe ids never reach the browser
```

### Decisions that differ from the brief, and why

- **Reserve price lives in `auction_private`**, not `auctions`. Every column of `auctions` is readable by the public (REST and Realtime), so a reserve stored there would leak. The public sees `has_reserve` and `reserve_met`; `place_bid` computes `reserve_met` server-side.
- **`bid_holds` table added.** The hold is per auction per user. `place_bid` checks for an authorized hold, so the RPC can't be called around the Stripe step.
- **`bids` is not in the Realtime publication.** Clients subscribe to the `auctions` row (one event per bid) and refetch history through `get_bid_history()`, which exposes usernames only.
- **Added columns** the spec sheet needs: `engine`, `transmission`, `drivetrain`, `exterior_color`, `damage_history_summary`, `inspection_date`, `inspection_highlights`, plus `leading_bidder_id`, `has_reserve`, `reserve_met`.
- **Money is whole euros (`integer`).** Stripe amounts are `euros * 100`.
- **Anti-sniping follows the brief literally**: `ends_at + 2 min`. A common alternative is `greatest(ends_at, now() + 2 min)`, which guarantees exactly two minutes after the last bid. Change one line in `place_bid` if you prefer it.

### Stripe hold: things to know before launch

- **Card authorizations expire after about 7 days.** Keep auctions at 7 days or less, or re-authorize before expiry. The PaymentIntent uses `setup_future_usage: "off_session"`, so the saved card can also be charged off-session for the premium if the hold has lapsed.
- The winner's hold is kept by the release job and used for the buyer's premium (see "Paying for a won car").
- Webhook events to enable: `payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `payment_intent.payment_failed`, `payment_intent.succeeded`. Every event is stored by id in `stripe_events` and handled once; failures are kept there with the error and shown in the admin's **Payments** section on each auction.
- **Test mode:** while `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` starts with `pk_test_`, every page shows a yellow "Test mode: no real payments. Use Stripe test cards." banner. It never shows with live keys.

### Paying for a won car

DECISIONS.md point 12. The car is paid to the seller outside Biddr; the buyer's premium (5%, €350–€3,500, `buyers_premium()`) is the only payment to Biddr.

- **Settlement** (`lib/settlement.ts`, `/api/stripe/settle`, called when an auction is sold and every 5 minutes): captures min(premium, €500) from the winner's hold (partial capture), then charges any rest off-session to the card saved with the hold (`setup_future_usage: "off_session"`). If the hold expired or was released, the whole premium is charged to that card. Each attempt claims the row first and Stripe calls carry idempotency keys, so nothing is charged twice.
- **Outcomes:** `paid` (receipt stored; winner and seller notified), `action_required` (the bank wants the winner to confirm: 72 hours, `premium_due` notification), `failed` (reason stored; winner and admins notified). The winner pays `action_required` and `failed` premiums on **My purchases** → Complete payment (Stripe Payment Element, 3-D Secure; `/api/stripe/premium/intent` and `/confirm`, plus the `payment_intent.succeeded` webhook as backstop).
- **Contact exchange:** after `paid`, My purchases shows the seller's full name, phone and email and My listings shows the winner's (`lib/contacts.ts`, read on the server for the two parties only).
- **Admin → Payments** (`/admin/payments`): every premium with status filters, Stripe links, **Retry charge**, **Mark as cancelled** (with a reason) and **Refund premium** (Stripe refund of both parts, after a confirmation). All logged in `admin_actions`.
- **The winner doesn't pay** (`lib/settlement.ts` `processDeadlines`, `lib/after-sale.ts`, migration 0025): each settlement run sends the reminder 24 hours before the deadline and closes payments past it as `unpaid` (what was taken from the hold is kept and invoiced, the winner is blocked from bidding, seller and admins are notified). The seller chooses on My listings: **Offer to the next bidder** (their highest bid; 48 hours to accept and pay on My purchases, as a new `buyer_payments` row linked to the offer) or **Relist this car** (a new draft copying the seller's details and photos, not the result or Biddr's earlier reviews). Paid sales show "Pay the seller by" (7 days) and the seller's **Sale completed**. **Admin → Users** lists blocked members and lifts a block with a reason.
- **Receipts** (`lib/receipts/issue.ts`, `renderReceiptPdf` in `lib/invoice/pdf.ts`, `/api/receipts/[id]`, migration 0031): a payment receipt when a premium is paid in full (`markPaid` in `lib/settlement.ts`; the settlement job issues missing ones) and a refund receipt per refund (the admin's refund, and Stripe's `charge.refunded` webhook for partial refunds made in Stripe). Numbers `R-<year>-0001` from `issue_receipt()` (no gaps, one payment receipt per payment, each Stripe refund receipted once). PDFs in the private `receipts` bucket; the download route checks the winner (RLS) or an admin and redirects to a 60-second signed link. Notification `receipt_ready`, emailed with the PDF. Stripe webhook event to add: `charge.refunded`.
- **Fake-listing checks** (`lib/listing-checks/`, `/account/listings/[id]/verify`, migration 0030, DECISIONS.md point 16): the seller uploads the registration certificate and takes two photos with the in-app camera and a 15-minute code (`challenge-camera.tsx`, no file upload). `extract.ts` asks Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-5-5`; low confidence → once more with `claude-opus-5-5`; server-side refusal fallbacks on) for values only, in a strict JSON schema; `compare.ts` decides pass / warn / fail in code and green / yellow / red; `vision.ts` runs Google Cloud Vision web detection on the public photos. Results in the admin-only `listing_checks`, costs in `listing_check_costs`, everything else in `listing_verifications`. Red puts the listing on hold (one retry, then the admins); yellow goes to **Admin → Needs a check**. **Approve and schedule** needs a verified seller and green checks, or a logged override. **Seller identity** (`lib/identity.ts`): Stripe Identity, requested when an admin approves the content; the webhook re-runs the owner check. Files are deleted 30 days after the auction ends (`/api/listing-checks/purge`, daily). New environment variables: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional), `GOOGLE_VISION_API_KEY` (see `.env.example`). Stripe webhook events to add: `identity.verification_session.verified`, `identity.verification_session.requires_input`, `identity.verification_session.processing`, `identity.verification_session.canceled`. In the tests, `e2e/mock-apis.mjs` stands in for both APIs and `lib/stripe-sim.ts` for Stripe Identity.
- **Contact seller and viewing requests** (`/auctions/[id]/contact`, `lib/messages.ts`, `app/account/messages/[id]/viewing.tsx`, `/admin/messages`, migration 0029): before bidding, a member who could bid (no card hold needed) opens a conversation about an upcoming or live car with a topic. Messages go through `send_message`, which masks phone numbers, emails and links (`mask_contact_details`, originals in the admin-only `messages_private`) until the buyer's premium is paid. `propose_viewing` / `respond_viewing` handle 1–3 proposed times; `share_phone` reveals a phone number only after a confirmed viewing. `conversation_state()` decides the phase and whether a conversation takes messages (read-only for buyers who didn't win once the auction ends). `conversation_on_paid` turns the winner's conversation into the after-sale one. **Report** (`report_conversation`) lists it on **Admin → Reported conversations**, with the original text, **Close conversation** and **Block user from messaging** (lifted on Admin → Users). Limits: 20 messages an hour, 10 new conversations a day.
- **Messages and reports** (`lib/messages.ts`, `lib/reports.ts`, `/account/messages`, `/admin/reports`, migration 0026): the buyer and seller message each other once the premium is paid (live through Realtime; Ctrl+Enter sends). **Report a problem** on the conversation page goes to admins; **Admin → Reports** shows the report, the conversation only while the report is open (each view logged as `conversation.view`), and lets admins write as Biddr support, block the buyer from bidding or the seller from selling, and resolve with a decision posted to the conversation.
- **Emails** (`lib/email/`, `/api/email/send`, migration 0028): the emails in DECISIONS.md point 15 follow their notifications, once each, newest first, retried every 5 minutes (at most 5 tries, only for notifications from the last 24 hours, so switching email on doesn't send old news). The winner's "premium paid" email has the invoice PDF attached. **Off until configured.** To switch them on:
  1. Create an account with an email provider that offers SMTP (e.g. Resend), and verify your domain there (DNS records).
  2. In Vercel → Settings → Environment Variables (Production), add `SMTP_HOST` (Resend: `smtp.resend.com`), `SMTP_PORT` (`465`), `SMTP_USER` (Resend: `resend`), `SMTP_PASS` (the API key) and `EMAIL_FROM` (e.g. `Biddr <noreply@biddr.org>`). Redeploy.
  3. Optional but recommended: use the same SMTP for Supabase's sign-in emails (Supabase → Authentication → Emails → SMTP Settings), then raise the email rate limit.
- **Invoices** (`lib/invoice/`, migration 0024): one invoice per paid premium, issued when it's paid (or by the next settlement run if that failed), and a credit note when it's refunded. Numbers run `BID-<year>-00001` without gaps, shared by invoices and credit notes. The premium includes VAT at the rate of the country the car is in (`lib/invoice/vat.ts`, an intermediary service to a private person); to be confirmed by the accountant. Each invoice keeps a snapshot of what it shows and can't be changed or deleted. The PDF (`/api/invoices/[id]`, `pdf-lib` with the Liberation Sans font, SIL OFL; opens in a new tab in the browser's PDF viewer, which can save it) is for the buyer and admins only, and carries a "Test mode" line while Stripe keys aren't live. **Admin → Invoices** lists them by period with VAT totals per country and a CSV for the accountant. Biddr's details on new invoices come from `lib/company.ts`: **the registry code, VAT number, address and email there are placeholders** until the real ones exist.
- **Tests:** stripe-mock can't act out captures or declines, so with `E2E_STRIPE_MOCK=true` (test keys only) `lib/stripe-sim.ts` answers for the test's own `pi_e2e_…`/`pm_e2e_…` ids. It is never used with real Stripe.

### Scheduled jobs

- Auction state changes (live, sold, ended…) run inside the database every minute (`pg_cron`: `advance_auction_states`).
- Card-hold releases run every 5 minutes: `pg_cron` calls `/api/stripe/release` through `pg_net` with the `CRON_SECRET` header (`public.call_app_job`, migration 0021). It needs two Supabase Vault secrets, set once in the SQL Editor:

  ```sql
  select vault.create_secret('https://YOUR-SITE.vercel.app', 'biddr_site_url');
  select vault.create_secret('THE SAME VALUE AS CRON_SECRET IN VERCEL', 'biddr_cron_secret');
  ```

  Until both exist the job does nothing. The daily Vercel cron in `vercel.json` stays as a backup. Check that it works in Supabase: `select status_code, content from net._http_response order by id desc limit 5;` should show `200` and `{"released":…}`.

## Folder structure

```
app/
  layout.tsx                    Archivo variable font (wdth axis), skip link, header, footer
  not-found.tsx                 site 404 (Next's default forces black text)
  how-it-works/page.tsx         bidding, card hold, premium, reserve, extensions, badges, selling
  about/page.tsx                what Biddr is (linked from the menu and the footer)
  terms/, privacy/              placeholders until the legal text is ready
  terms/bidding/page.tsx        bidding terms placeholder, shows the current version
  globals.css                   palette tokens, shadcn variables, .font-wide
  page.tsx                      Home: filters + live feed
  auctions/[id]/page.tsx        Auction detail (server data load)
  auctions/[id]/not-found.tsx
  login/page.tsx, login-form.tsx  Google + email link / 6-digit code sign-in
  auth/callback/route.ts        code exchange, sends new users to profile setup
  auth/signout/route.ts         POST only
  account/setup/                profile form (page, client form, server action)
  account/listings/page.tsx     the member's own listings, any status
  sell/page.tsx                 profile gate, renders the form
  sell/sell-form.tsx            client state owner: steps, localStorage draft, upload queue
  sell/*-step.tsx, field.tsx    one component per step, shared field wrapper
  sell/actions.ts               submitListing(): re-validates, inserts the draft
  sell/submitted/page.tsx       confirmation and next steps
  admin/layout.tsx              admins only (after two-step verification); everyone else gets a 404
  two-factor/                   the admin's second step: authenticator code, or QR setup the first time
  admin/page.tsx                tabs: to review, scheduled, live, finished, rejected or withdrawn
  admin/auctions/[id]/          one page per auction: seller, listing, photos, inspection,
                                pricing, schedule, status actions, bids, comments
  admin/actions.ts              every admin write: requireAdmin() first, then zod, then audit
  api/admin/inspection-upload/  signed upload URL for the redacted public copy of a dealer report (admins only)
  api/admin/inspection-file/    opens a seller's private report file through a 60-second signed URL (admins only)
  api/stripe/hold/route.ts
  api/stripe/hold/confirm/route.ts
  api/stripe/webhook/route.ts
  api/stripe/release/route.ts
components/
  auction/
    auction-feed.tsx            client grid + Realtime
    auction-card.tsx, featured-lot.tsx, auction-filters.tsx
    auction-view.tsx            the auction page layout, shared by /auctions/[id] and the sell preview
    preview-banner.tsx          banner above listing previews
    auction-search.tsx          home page search box with suggestions (ARIA combobox)
    auction-live.tsx            detail page state owner + Realtime channel
    bid-box.tsx, sticky-bid-bar.tsx, bid-modal.tsx, bid-history.tsx
    gallery.tsx, inspection-card.tsx, spec-sheet.tsx, video-player.tsx
    comments.tsx, countdown.tsx, badges.tsx
  site-header.tsx               Auctions, How it works, Sell a car (outline button), bell, account; "Menu" on small screens
  mobile-menu.tsx               disclosure menu for small screens: Sell a car button first, then the links
  nav-link.tsx                  header link marked aria-current on its page
  site-footer.tsx               the same help links on every page
  notifications/                header bell and the shared notification item
  account-menu.tsx              My listings (unanswered questions), My purchases, Messages, Watchlist, Profile, Admin, Sign out
  share-button.tsx              native share sheet or Copy link / Facebook / WhatsApp / X / Email
  auction/watch-button.tsx      Watch / Watching toggle and "<n> watching"
  ui/                           shadcn/ui: button, dialog, input, tabs, textarea, native-select
hooks/use-server-clock.ts       shared 1 Hz ticker + server clock offset
lib/
  supabase/client.ts, server.ts
  stripe.ts, holds.ts, pricing.ts, errors.ts, format.ts, types.ts, utils.ts
  redirect.ts                   safeNext(): same-site ?next= paths only
  login.ts, profile.ts          shared copy, types and constants for auth pages
  sell.ts                       /sell constants, zod step schemas, status labels (client + server)
  listing-details.ts            highlights, equipment, flaws, service history...: schemas, labels, display helpers
  photo-upload.ts               browser-only: resize to WebP, upload with progress
  admin.ts                      server-only: requireAdmin(), logAdminAction()
  admin-schemas.ts              admin zod schemas, tabs and labels (client + server)
  zoned-time.ts                 date + time in a given time zone <-> UTC, and display with the zone abbreviation
  countries.ts                  the 27 EU countries
  demo/                         demo data: seed/remove, cover photos (demo/photos/), placeholder photos and PDF, bid generator
  site.ts                       footer links, support email and company placeholders
  bidder.ts                     server-only: bidder_status() check used by the hold route
  notifications.ts              notification wording, links and select columns (client + server)
  listing-preview.ts            preview texts and the preview auction built from the sell form
  search.ts                     ?q= cleanup, debounce and wording for the home page search
middleware.ts                   session refresh, sends signed-out users on /sell, /admin, /account to /login, admins without two-step verification to /two-factor
supabase/migrations/0001_init.sql
supabase/migrations/0002_service_role_grants.sql
supabase/migrations/0003_sell.sql
supabase/migrations/0004_admin.sql
supabase/migrations/0006_demo_data.sql
supabase/migrations/0007_listing_details.sql
supabase/migrations/0008_bidder_requirements.sql
supabase/migrations/0009_notifications.sql
supabase/migrations/0010_watchlist.sql
supabase/migrations/0011_newly_listed_index.sql
supabase/migrations/0012_search.sql
supabase/migrations/0013_optional_inspections.sql
supabase/migrations/0014_dealer_inspections.sql
supabase/migrations/0015_seller_withdraw.sql
supabase/migrations/0016_seller_inspection_decision.sql
supabase/migrations/0017_inspected_by_seller.sql
supabase/migrations/0018_eu_countries.sql
tests/a11y/                     axe, reflow and keyboard tests + mock Supabase (npm run test:a11y)
e2e/                            end-to-end tests: one spec per area, helpers, seed (npm run test:e2e)
playwright.e2e.config.ts        end-to-end test projects (desktop Berlin, phone Tallinn) and test server
supabase/config.toml            local, test-only Supabase stack (never used in production)
scripts/check-migrations.sh     applies every migration a second time and compares the schema
.github/workflows/e2e.yml       runs the tests on every pull request and push to main
vercel.json                     daily cron for hold release (/api/stripe/release, 00:00 UTC)
```

## Testing

See [TESTING.md](TESTING.md). `npm run test:e2e` runs the end-to-end tests against a local Supabase stack, a local mail catcher and stripe-mock, with no real keys, users or payments. `npm run test:migrations` proves every migration can run twice. [MANUAL_TESTS.md](MANUAL_TESTS.md) lists what a person still needs to check (Google sign-in, real cards, real emails, real phones, link previews). All automated tests run on every pull request.

## Accessibility

Product decisions live in [DECISIONS.md](DECISIONS.md); check changes against them. The last full review is in [CONSISTENCY_REVIEW.md](CONSISTENCY_REVIEW.md).

The site targets WCAG 2.2 AA. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for what was checked and what's still open. `npm run test:a11y` runs axe, reflow and keyboard checks on every page against a mock Supabase, with no keys needed.

## Environment variables

See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `GOOGLE_VISION_API_KEY` are server-only. `ENABLE_DEMO_DATA=true` turns on the admin demo-data tools; keep it `false` in production. `NEXT_PUBLIC_SITE_URL` (e.g. `https://biddr.ee`) must be set in Vercel for share links and link previews.

## Setup

```bash
npm install
cp .env.example .env.local            # fill in keys
supabase link --project-ref <ref>
supabase db push                      # runs 0001_init.sql (enables pg_cron)
npm run db:types                      # optional: generate lib/database.types.ts
stripe listen --forward-to localhost:3000/api/stripe/webhook
npm run dev
```

In Supabase: enable the `pg_cron` extension if `db push` reports it missing, and add your storage bucket host to `next.config.mjs` if you serve images from elsewhere.

## Run in Supabase

Migrations are applied by hand in the Supabase SQL Editor. Each file is idempotent, so running one twice is safe.

| File | What it does | Status |
| --- | --- | --- |
| `0001_init.sql` | Schema, RLS, `place_bid`, cron | Applied |
| `0002_service_role_grants.sql` | Gives `service_role` access to everything in `public`, now and for future objects | Applied in production |
| `0003_sell.sql` | `auctions.variant`, seller fields on `auction_private`, one open listing per VIN, `auction-photos` bucket and its policies | Run before using `/sell` |
| `0004_admin.sql` | `rejected` and `withdrawn` statuses, `rejection_reason`, `admin_actions` audit log, `inspection-reports` bucket, `admin_set_reserve` and `admin_set_schedule` | Run before using `/admin` |
| `0006_demo_data.sql` | `is_demo` on auctions and profiles, demo listings refuse bids, comment trigger lets the server set the author, comments insert grant tightened | Run before using demo data |
| `0007_listing_details.sql` | Structured listing details: body style, interior colour, ownership, seller type and dealer, registration, highlights, equipment, modifications, known flaws, service history, items included and seller notes. Also adds an `editor_take` column the app doesn't use. | Run before deploying this version (the sell form saves these columns) |
| `0008_bidder_requirements.sql` | Bidders need a complete profile and the current bidding terms: `accept_bidding_terms`, `bidder_status`, `current_bidding_terms_version`, and triggers on `bids` and `comments` | Run before deploying this version (bidding stays closed until it is run) |
| `0009_notifications.sql` | `notifications` table (own rows only, browser may only set `read_at`), Realtime, triggers for questions, answers, outbids, listing and auction status changes, and a daily cleanup of notifications older than 90 days | Run before deploying this version (the header bell reads this table) |
| `0010_watchlist.sql` | `watchlist` table (own rows only), `auctions.watch_count` kept by triggers, auto-watch when you bid, "now live" and "ends within the hour" notifications for watchers (cron every 5 minutes) | Run before deploying this version (Watch buttons and the demo loader use it) |
| `0011_newly_listed_index.sql` | Index for the Newly listed tab (`status, starts_at desc`) | Optional, speeds up the tab |
| `0012_search.sql` | Free-text search: `pg_trgm` and `unaccent` extensions, `auctions.search_text` and `search_words` kept by a trigger (and filled for existing cars), a trigram index, the `search_aliases` table (vw, merc, beemer...), and the `search_auctions` and `search_suggestions` functions | Run before deploying this version (the home page search uses it) |
| `0013_optional_inspections.sql` | Inspections become optional: drops the `restored_needs_inspection` check so restored cars can be approved without one, adds `auction_private.inspection_requested` (city required only when it is true), and lets the search filter by any restored car | Run before deploying this version (the sell form saves the inspection choice) |
| `0014_dealer_inspections.sql` | Authorised dealer inspections: dealer report and review columns on `auction_private`, `auctions.inspection_type`, the private `inspection-uploads` bucket (owners write and delete only in their own folder, no public read), the `inspection_rejected` notification type, and `search_auctions` re-created to return `inspection_type`. The old partner-booking columns stay but are no longer used | Run before deploying this version (the sell form and admin review use it) |
| `0015_seller_withdraw.sql` | Seller withdrawals: `withdraw_reason`, `withdraw_requested_at` and `withdraw_request_status` on `auction_private`, the `seller_withdraw` and `seller_request_withdrawal` functions (signed-in users only), `auctions.withdrawn_before_review` so a draft withdrawn before review stays private, the schedule rule allowing a withdrawn listing without times, and the `withdrawal_approved` / `withdrawal_declined` notification types | Run before deploying this version (My listings and the admin pages use it) |
| `0016_seller_inspection_decision.sql` | The seller's choice after a rejected dealer report: `seller_decision_required`, `seller_decision_deadline`, `seller_decision` and `seller_decision_at` on `auction_private`, the `seller_inspection_decision` function (signed-in users only), a daily `pg_cron` job (`inspection-decision-deadlines`, 06:41 UTC) that reminds the seller 7 days before the deadline and withdraws the listing once it passes, and three notification types | Run before deploying this version (Reject report, My listings and the daily job use it) |
| `0017_inspected_by_seller.sql` | `inspected_by_seller` on `auction_private` and `auctions`: the admin confirms a dealer seller inspected its own car, and the listing says "Inspected by the selling dealer" | Run before deploying this version (the admin review and auction page read it) |
| `0018_eu_countries.sql` | All 27 EU countries: adds them to the country type used by profiles and car locations, and widens the registration-country check (old `other_eu` values stay valid) | Run before deploying this version (profile, sell form and filters offer every EU country) |
| `0022_buyer_payments.sql` | `buyer_payments` (one row per sold auction: winning bid, premium, what came from the hold, the rest, status, due date, receipt; winner and seller read their own row, no browser writes), a trigger that creates the row when an auction is sold and calls the settlement job, a `pg_cron` job retrying it every 5 minutes, and the `premium_due`, `premium_paid` and `premium_failed` notification types | Run before deploying this version (needs 0021 and its Vault secrets) |
| `0023_car_makes.sql` | `auctions.make_other` (the seller chose "Other": a make that isn't in `lib/data/car-makes.ts`) and the `make_suggested` notification type for admins | Run before deploying this version |
| `0024_invoices.sql` | `invoices` (one invoice and at most one credit note per buyer's premium; the buyer reads their own, nothing can be changed or deleted), `invoice_counters` and `issue_invoice()` (numbers `BID-<year>-00001` without gaps) | Run before deploying this version |
| `0025_buyer_did_not_pay.sql` | "Buyer didn't pay": `buyer_payments` gets the `unpaid` status, the 24-hour reminder, `sale_completed_at` and second-chance links, and one *active* payment per auction (was: one per auction); `profiles.bidding_blocked_at`/`bidding_block_reason` (no member access), checked by `bidder_status()` and the bids trigger; `second_chance_offers`; `auctions.relisted_from`; six notification types | Run before deploying this version (needs 0022) |
| `0026_messages_reports.sql` | `conversations` (one per paid sale, opened by a trigger) and `messages` (text only, never changed; written only through `send_message()`: parties only, read-only after the sale, 2,000 characters, 30 per 10 minutes, one notification per conversation until read), `mark_conversation_read()`, Realtime on messages, a daily job deleting conversations 3 years after the sale; `sale_reports`; `buyer_payments.sale_failed_at`; `profiles.selling_blocked_at`/`selling_block_reason` checked when a car is submitted; five notification types | Run before deploying this version (needs 0025) |
| `0027_typing_and_seen.sql` | Realtime on `conversations` (so "Sent" turns into "Seen" live) and policies on `realtime.messages` that let only the buyer and seller join the private broadcast channel `conversation:<id>` used for "typing…" (nothing stored) | Run before deploying this version (needs 0026) |
| `0028_email_outbox.sql` | `notifications.emailed_at`/`email_attempts`/`email_error`, `notification_is_emailed()`, a trigger that asks the app to send right away, and a `pg_cron` job (every 5 minutes) for retries; both call `/api/email/send` | Run before deploying this version (needs 0021 and its Vault secrets) |
| `0021_payments_scheduling.sql` | Stripe webhook event log (`stripe_events`, service role only) and `call_app_job()`, which lets `pg_cron` call the site's protected job routes through `pg_net`; the card-hold release runs every 5 minutes | Run before deploying this version, then add the two Vault secrets (see "Scheduled jobs") |
| `0020_history_reports.sql` | Vehicle history reports (carVertical): the seller's files, share link, sharing permission and Biddr's review on `auction_private`; `history_report_verified`, `history_summary` (2–8 lines, 200 characters each) and `history_report_public_link` (only when sharing is allowed) on `auctions`; the `history_report_rejected` notification type | Run before deploying this version (the sell form, admin review and auction page use it) |
| `0019_admin_two_factor.sql` | `is_admin()` is true only after two-step verification (`aal2`), so admin rights in the database need the authenticator code too | Run when deploying this version (admins then sign in with Google and a code) |

## Vehicle history reports (carVertical)

Optional for every car (DECISIONS.md point 11). Rules and wording live in `lib/history-report.ts`.

- **Sell form** (Price and inspection step): "Do you have a carVertical vehicle history report for this car?" With "Yes, add it", the seller uploads the report (PDF or photos, to the private `inspection-uploads` bucket under their own folder) and/or pastes the carVertical share link (https, carvertical.com), and can tick "I'm allowed to share this report with buyers". Saved to `auction_private` with review status `pending`.
- **Admin review** (`/admin/auctions/<id>`, History report section): files open through one-minute signed URLs (`/api/admin/inspection-file?…&kind=history`). **Accept** needs all three checks (VIN matches; report mileage not higher than the listing and consistent; damage records match the description) and 2 to 8 summary lines; it sets `history_report_verified`, `history_summary` and, only if the seller allowed sharing and gave a link, `history_report_public_link`. **Reject** needs a reason; the seller is notified and, while the listing is in review, can upload another report or correct the damage description under My listings (either sends it back for review). Both are logged in `admin_actions`.
- **Auction page:** an accepted report shows the "History report" badge (with an info tip) near the title and the "Vehicle history report" section with Biddr's summary, plus "View the full report" only when the link is public. Otherwise the section says no report was provided and offers **Copy VIN** and **Check on carVertical** (carVertical's home page: it documents no link that pre-fills a VIN). Cars from before 1990 also get a note that history databases have little data for older cars.

## Admin sign-in (two-step verification)

Admins sign in from the normal sign-in page: the small **Sign in as an admin** link at the bottom opens a dialog with **Continue with Google** only. After Google, `/two-factor` asks for the 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). The first time, it shows a QR code (and the key, to type in by hand) to add Biddr to the app.

- Until the code is entered, the admin is treated like any member: `/admin` sends them to `/two-factor` and back, admin actions and `/api/admin/*` answer 404, and `is_admin()` in the database is false.
- Supabase: Authentication → Multi-Factor → TOTP must be enabled (it is by default), and Google must be set up as a sign-in provider.
- An admin who loses their phone: in Supabase, Authentication → Users → the admin → remove their MFA factor. Next sign-in shows a new QR code.

## Selling a car (`/sell`)

Signed-in members with a complete profile (username and country) submit a car in six steps: Car, History, Details, Photos, Price and inspection, Review. The listing is saved as a `draft` for an admin to review; nothing is public until an admin schedules it.

- **Draft on the device.** The form keeps all state in `sell/sell-form.tsx` and saves it to `localStorage` under `biddr:sell:v1:<user id>`, so a refresh keeps the work. "Start over" clears it and deletes the uploaded photos.
- **Photos go straight to Storage.** The browser resizes each photo (longest edge 2560 px, WebP at 0.85; JPEG where the browser can't encode WebP) and uploads it to `auction-photos/<user id>/<draft id>/<section>/<random>.webp`. Storage policies only allow writes inside the user's own folder.
- **Validated twice.** Each step is checked with the zod schemas in `lib/sell.ts` before Continue, and `submitListing` runs them all again. It also accepts only photo URLs from the user's own draft folder.
- **What is stored where.** The `auctions` row is inserted with the user's own client, so RLS and column grants apply and `status` stays `draft`. Only after that insert succeeds, the service role writes the requested reserve and the dealer inspection details (whether a report was provided, the dealer, date, mileage and the report's private file paths, with review status `pending`) to `auction_private` (admin-only) and sets `has_reserve`. If that second write fails, the draft is deleted so the seller can submit again.
- **One open listing per VIN.** A VIN that is already a draft, scheduled or live is refused with "This car is already listed or waiting for review."
- **Structured details.**
  - The Car step asks for body style, interior colour, number of owners, seller type (dealers give a company name and registry code) and registration.
  - The Details step collects highlights (3 to 10), equipment, modifications (or "factory specification"), known flaws (or "not aware of any flaws"), service history rows (month, mileage, work, workshop), items included and seller notes.
  - Every list allows at most 40 items of 300 characters each; the database enforces the same limits (`0007`).
  - Drafts saved before the Details step existed open on that step.
- **Car makes** (`lib/data/car-makes.ts`): the static list of makes, the popular makes and the aliases search understands. To add a make, add it to `CAR_MAKES` in alphabetical order (and to `MAKE_ALIASES` if it has another common name). The sell form and the admin editor search it with an accessible combobox (`components/ui/make-combobox.tsx`); a make that isn't listed can be entered as "Other", which sets `auctions.make_other` and notifies admins.
- **Full-screen photos** (`components/auction/photo-viewer.tsx`): clicking or tapping a gallery photo, or its "Click to enlarge" button, opens it full screen at full resolution. It goes through every section in order, zooms (click, wheel, pinch, double-tap or the buttons), and the back button closes it (it adds `#photo-<n>` to the address). No database changes.
- **The auction page** shows, under the gallery: highlights, the inspection, specifications, equipment, modifications, known flaws, service history (a table, newest first), items included, seller notes, then the video. Empty optional sections are hidden, and lists longer than 8 items get a "Show all" button.
- `/account/listings` shows the member's own listings with their status. The header links to it as "My listings".

Photos from a draft that is never submitted stay in the bucket. Clean them up later with a scheduled job that removes folders with no matching auction.

### Dealer inspections

The only inspection Biddr accepts is a **pre-sale inspection by an authorised dealer of the car's brand, in any EU country**. The seller arranges it and uploads the report; an admin checks it during listing review. Inspections are optional for every car. (An earlier inspection-booking feature was removed; its old columns stay in the database unused.)

- **Sell form** (Price and inspection step): "Do you have a pre-sale inspection report from an authorised <make> dealer?" (required, no default).
  - **Yes** asks for the dealer's name, city and EU country, the inspection date (not in the future, at most 90 days old), the mileage on the report, and the report itself: a PDF or photos, up to 10 files of 20 MB. Files go to the **private** `inspection-uploads` bucket under `<user id>/<draft id>/`. The server checks every path is in the seller's own draft folder and that the file exists, then saves the details with review status `pending`.
  - **No** hides those fields. For accident-repaired cars the seller is told the listing will show the car hasn't been inspected by a dealer.
- **Admin review** (`/admin/auctions/<id>`, Inspection section): the dealer details, report mileage against listing mileage, and plain warnings when the report shows more kilometres than the listing or is more than 90 days old at the scheduled start. Each file opens through a signed URL that lasts one minute (`/api/admin/inspection-file`).
  - **Accept report** needs all four boxes ticked ("Dealer is an authorised dealer of this brand", "VIN on the report matches the listing", "Mileage is consistent", "Report date is within 90 days") and 3 to 6 highlights. It sets `inspection_type = 'authorised_dealer'`, the public dealer name and city, date and highlights. The checklist is saved with the decision in `admin_actions`. After accepting, the admin can upload a **redacted** PDF to the public `inspection-reports` bucket for buyers to download.
  - **Reject report** needs a reason and works while the listing is waiting for review. It clears every public inspection field and the **seller decides** what happens next (see below).
  - Approving a listing never requires an inspection.
- **Buyers** see the **Dealer inspected** badge (cards, featured car, auction page) only when `inspection_type = 'authorised_dealer'`. The inspection card says "Inspected by <dealer, city> (authorised <make> dealer) on <date>. Report checked by Biddr.", lists the highlights, and offers "Download report (PDF)" only when a redacted copy exists. Specifications have an "Inspection" row: "Dealer inspected" or "Not inspected". An accident-repaired car without one shows its repair description and "This accident-repaired car hasn't been inspected by an authorised dealer. Ask the seller for repair documents and photos." When the admin ticks **Inspected by the selling dealer** (dealer sellers only, `inspected_by_seller`, `0017`), the badge stays but the card says "Inspected by the selling dealer, <dealer, city> …" and the info tip says it isn't an independent check.
- **Home page History filter**: "Accident repaired" (any accident-repaired car) and "Accident repaired, dealer inspected". The URL values (`restored_any`, `restored`) stay the same so old links keep working.
- **Badge names**: "Dealer inspected" (accepted authorised-dealer report) and "Accident repaired" (the seller declared accident damage and its repair; Biddr doesn't check the repair itself). Both have info tips on the auction page; /how-it-works explains them in full.
- Listings with an inspection from before `0014` have no `inspection_type`, so they show "Not inspected" until a dealer report is accepted for them.

### Previewing a listing

- **Before submitting:** on the Review step, **Preview listing** opens the auction page exactly as buyers will see it (`/sell?preview=1`), built from the form's answers and the photos already uploaded. Nothing is saved. A banner at the top has **Back to edit** (the browser's Back button works too) and **Submit for review**.
- **After submitting:** in **My listings**, drafts and rejected listings have a **Preview** link to their auction page. Only the seller and admins can open it; everyone else gets "This auction isn't listed" (the database already hides these rows). A banner says "Waiting for review." or "Not accepted:" with the reason, and admins also get **Open in admin**. These pages are marked `noindex`.
- In a preview, bidding ("Bidding opens after review"), questions ("Questions open when the auction starts"), Watch and Share are turned off, and the inspection section says "Your dealer inspection report will show here once Biddr has checked it" when a report is waiting for review. The preview uses the same components as the live auction page (`components/auction/auction-view.tsx`), so the two can't drift apart.

### After a rejected dealer report: the seller decides

When an admin rejects a dealer inspection report, the listing doesn't go ahead without a badge on its own. The seller chooses:

1. **Upload a new report**: the same dealer fields and upload as in the sell form (files in their own folder, `<user id>/<auction id>/`). It replaces the report (the rejected files are deleted), goes back to review as `pending`, and goes through the same four-item checklist again.
2. **List without an inspection**: after a confirmation ("Your listing will go live without a Dealer inspected badge. Buyers will see that the car hasn't been inspected by a dealer."), calls `seller_inspection_decision(..., 'without_inspection')`. The admin can then approve the listing without a badge.
3. **Withdraw listing**: the normal withdraw.

- **Reject report** sets `seller_decision_required` and a deadline 30 days ahead, and notifies the seller ("Your inspection report wasn't accepted: <reason>. Choose how to continue."). It only works while the listing is waiting for review; move a scheduled listing back to review first.
- **Seller**: My listings shows "Waiting for your decision" and a panel with the reason, "Please choose by <date>" and the three choices. The same panel shows on the listing preview.
- **Admins**: while the seller decides, **Approve and schedule** is disabled with "Waiting for the seller to choose: new report or list without an inspection." and the deadline. When the seller chooses, every admin is notified ("<car>: seller chose a new report / to list without an inspection") and the review panel shows the choice.
- **Deadline**: a daily job (`inspection_decision_job`) sends one reminder 7 days before the deadline. When it passes, the listing is withdrawn with the reason "No response after the inspection report was rejected", stays private (it was never public), and the seller is notified.
- `seller_inspection_decision` checks the caller is the seller, the listing is a draft and a choice is due; errors: `NOT_OWNER`, `NOT_DRAFT`, `NO_DECISION_NEEDED`, `NEW_REPORT_NEEDS_UPLOAD` ('new_report' is saved by the server together with the upload), `INVALID_DECISION`.

### Withdrawing a listing

Sellers withdraw their own listings from **My listings** (`/account/listings`), as on most auction sites:

| Status | What the seller can do |
| --- | --- |
| Waiting for review (`draft`), Scheduled (`upcoming`) | **Withdraw listing**: a confirmation with an optional reason. The status becomes `withdrawn` right away (`seller_withdraw`). |
| Live | **Request withdrawal** only, with a reason of at least 20 characters and the note that live auctions can only be withdrawn by the Biddr team for a good reason, such as damage or a sale elsewhere (`seller_request_withdrawal`). The row then shows "Withdrawal requested" until an admin decides. |
| Anything else | Nothing. |

- Both functions lock the auction row, check that the caller is the seller and that the status allows it, and return clear error codes (`NOT_OWNER`, `NOT_WITHDRAWABLE`, `NOT_LIVE`, `REASON_LENGTH`, `ALREADY_REQUESTED`), shown to the seller in plain words.
- A draft withdrawn before review is marked `withdrawn_before_review` and stays private, like a draft: only the seller and admins can open it. A withdrawn scheduled listing stays public with "This auction was withdrawn", as before.
- **Admins**: the Live tab has a **Withdrawal requests** count and filter, and rows with a request say so. On the auction page a pending request shows at the top with the reason and two buttons: **Approve and withdraw** (confirmation says bids are cancelled and card holds released; then the same as Withdraw) and **Decline** (optional note to the seller). Both are logged in `admin_actions` and notify the seller.
- The seller's private fields (rejection reason, request status) are read on the server with the service role, for the seller's own listings only.

## Admin panel (`/admin`)

### Make someone an admin

The person signs in once (that creates their profile), then run this in the SQL Editor:

```sql
update public.profiles
   set role = 'admin'
 where id = (select id from auth.users where email = 'name@example.com');
```

To remove admin access, set `role = 'user'` the same way. The header shows an "Admin" link to admins; for everyone else `/admin` is a plain 404.

### What it does

- **Lists** every auction in five tabs with counts: To review (`draft`), Scheduled (`upcoming`), Live (ending soonest first), Finished (`ended`, `sold`, `reserve_not_met`) and Rejected or withdrawn.
- **Per auction** (`/admin/auctions/<id>`): every listing detail is editable. Admins aren't held to the seller-only rules (minimum highlights, declaring modifications and flaws), so older listings can be saved. Also on the page: seller contact details (email from Supabase Auth, phone and full name from `profiles`) and their requested reserve. The admin can edit the listing text, remove photos or change the cover, and review the seller's dealer inspection report (see [Dealer inspections](#dealer-inspections)). They also set the starting bid, increment and reserve, set the schedule in their own time zone (stored in UTC), and see all bids and delete comments.
- **Status changes**: approve and schedule or reject (with a reason the seller sees) a draft. Move a scheduled auction back to review, or withdraw it. Extend a live auction (+1 hour, +1 day or a custom later time), or withdraw it, which cancels the bids and releases the card holds straight away. Every destructive step asks for confirmation and says what will happen.
- **Rules the database enforces**: `admin_set_reserve` and `admin_set_schedule` lock the auction row like `place_bid`. While an auction is live, the reserve can only go down and the end can only move later. Inspections are optional for every car since `0013`, so restored cars can be approved without one. Auctions run at most 7 days because card holds expire after about 7 days.
- **Security**: browser clients still can't write status, price or schedule columns. Every admin write is a server action or route handler that calls `requireAdmin()` first, re-validates its input with zod, uses the service-role client only after that, and records the change in `admin_actions`. The redacted public report PDF goes straight from the browser to Storage through a signed upload URL the server creates for that auction only; sellers' original reports stay in a private bucket that only signed one-minute links can open.

## Bidding requirements

Before anyone can place a card hold or a bid, they need:

1. **A complete profile:** username, full name, country and phone number.
2. **The current bidding terms accepted,** with confirmation that they are 18 or older.

This is enforced in the database, not only in the UI:
- **Bids:** a trigger on `bids` raises `PROFILE_INCOMPLETE` or `TERMS_NOT_ACCEPTED`.
- **Comments:** a trigger on `comments` needs a username and country.
- **Card holds:** `/api/stripe/hold` runs the same check, `bidder_status()`, before it ever contacts Stripe, and stays closed if the check fails.
- **Server-side inserts:** these use the service role (for example demo data) and aren't affected.

The bid dialog walks people through the steps in order: sign in, finish profile, "Before your first bid" (terms), card hold, confirm bid. It skips any step that's already done. The profile page shows when the terms were accepted, and which version.

The terms text is a placeholder at `/terms/bidding` until the real terms are written with a lawyer.

### Changing the terms version
The version lives in one place: the database function `current_bidding_terms_version()`. To make everyone accept again, for example when the real terms replace the draft:

1. Update `/terms/bidding` with the new text.
2. Run this in the Supabase SQL Editor, with the new version string:

   ```sql
   create or replace function public.current_bidding_terms_version()
   returns text language sql stable as $$
     select '2027-01-final'::text
   $$;
   ```

From then on, everyone who accepted an older version sees the terms step again before their next bid, and the database refuses their bids until they accept. Nothing else needs to change: the page, the dialog and the checks all read the version from this function.

## Notifications

Signed-in members get a bell in the header. It shows the number of unread notifications and opens a panel with the 20 newest. `/account/notifications` has the full list, 50 per page, with an Unread filter. Both update live over Realtime.

| Type | Who | When |
| --- | --- | --- |
| `question` | Seller | Someone asks a question on their car |
| `answer` | Asker | The seller replies to their question |
| `outbid` | Previous high bidder | Someone outbids them |
| `listing_approved`, `listing_rejected` | Seller | An admin approves or rejects their listing |
| `auction_live`, `auction_ended` | Seller | Bidding opens; the auction closes |
| `auction_won` | Winning bidder | The car is sold to them |
| `listing_submitted` | Every admin | A new car is submitted for review |

How they're created and stored:
- **Triggers only.** Database triggers (`0009`) create them. Nobody is told about their own action, and demo auctions never notify.
- **Data, not sentences.** Rows hold only the type and ids/data. The wording lives in `lib/notifications.ts`, so it can be translated.
- **Cleanup.** A daily `pg_cron` job deletes notifications older than 90 days.

Opening a question or answer goes to the auction page at `#comment-<id>`. The comment is scrolled into view, focused and briefly highlighted.

## Watchlist and sharing

- **Watch** (the eye button on cards, on the auction page and in the bid box) adds a car to `/account/watchlist`. Bidding on a car adds it automatically.
- **Watch counts.** "<n> watching" comes from `auctions.watch_count`. Database triggers keep it in step, and it updates live.
- **Notifications for watchers:**
  - one when the auction goes live;
  - one when it has under an hour left (a `pg_cron` job every 5 minutes).

  Each is sent at most once per car, and never for demo listings.
- **Share** opens the phone's share sheet. On other devices it shows Copy link, Facebook, WhatsApp, X and Email.
- **Link previews.** Auction pages have Open Graph and Twitter tags and a generated 1200×630 preview image (`app/auctions/[id]/opengraph-image.tsx`). The image shows the cover photo, the title and the result, and demo listings are marked "Demo listing".

**Set `NEXT_PUBLIC_SITE_URL` in Vercel** (Project → Settings → Environment Variables), e.g. `https://biddr.ee`, then redeploy. Shared links and preview images use it to build absolute URLs. Without it, previews fall back to Vercel's deployment URL, and local development uses `http://localhost:3000`.

## Search (home page)

The search box above the tabs replaces the old Make filter. It searches make, model, variant, title and year.

- **Every word must match.** "bmw m3 2018" finds 2018 BMW M3s only. A four-digit number between 1950 and next year is a model year and must match exactly.
- **Spelling is forgiving.** Capitals, accents, spaces, hyphens and dots between letters and digits don't matter: "rs6", "RS 6" and "RS-6" are the same, as are "Skoda" and "Škoda".
- **Nicknames.** `search_aliases` turns vw into volkswagen, merc into mercedes, beemer and bimmer into bmw, chevy into chevrolet, landy into land rover, rr into range rover, alfa into alfa romeo and amg into mercedes amg. To add one, run in the SQL Editor (only the service role and the SQL Editor can change this table):

  ```sql
  insert into public.search_aliases (alias, canonical) values ('porker', 'porsche')
  on conflict (alias) do update set canonical = excluded.canonical;
  ```
- **Order.** Results keep the tab's order (Live: ending soonest first), with exact model matches first, so "m3" shows M3s before an M340i.
- **Suggestions** appear from two characters: up to six makes and models from listings people can see, with counts, e.g. "Audi RS6 Avant (3)". Use the arrow keys and Enter, or Escape to close.
- **The search is in the address** (`/?q=rs6`), so it can be shared and works with the tabs and the country and history filters. While searching, the featured car is hidden and the grid is titled "Results for “rs6” (3)". With no results the page offers past results for the same search, when there are any.
- Drafts and rejected listings never appear: the search functions run with the visitor's own permissions, so the usual access rules apply.

## Demo data (for testing)

The admin panel can fill the site with seven example auctions, with bids, comments and photos, and remove them again with one click. Each car's cover (its first exterior photo) is a real photo of that model from `lib/demo/photos/` (WebP, no metadata); the other photos are generated "Demo photo" placeholders. Use it to try the site before real cars are listed.

### Turn it on
1. Run `supabase/migrations/0006_demo_data.sql` in the Supabase SQL Editor (once).
2. In Vercel: Project → Settings → Environment Variables, add `ENABLE_DEMO_DATA` with the value `true`, then redeploy. Locally, put `ENABLE_DEMO_DATA=true` in `.env.local`.
3. Sign in as an admin and open **Admin**. The **Demo data** panel is at the bottom of the page.

### Use it
- **Load demo data** creates 1 demo seller and 5 demo bidders, and seven auctions marked "Demo":
  - live and closing in 12 minutes, 21 bids, reserve met (BMW M2 Competition);
  - live, ending in 26 hours, 6 bids, reserve not met yet (Audi RS6 Avant);
  - live with no reserve and no bids (Porsche 911 Carrera S: a restored car listed without an inspection, so the "Not inspected" state is visible);
  - live, ending in about 4 days, 8 bids, reserve met (Audi A5 Coupe, listed without an inspection);
  - scheduled for tomorrow 12:00 (Mercedes-AMG C63 S, sold by a fictional Mercedes-Benz dealer that inspected the car itself, so "Inspected by the selling dealer" is visible);
  - sold yesterday (BMW M3 Competition, a restored car with an accepted dealer inspection, before photos and a public demo report PDF);
  - ended 3 days ago below its reserve (Audi RS3 Sportback).

  Every car except the restored Porsche and the A5 has an accepted inspection from a clearly fictional dealer ("Demo BMW Centre", "Demo Audi Centre" and so on), with a placeholder report in the private bucket so the admin review panel can be tried.

  The demo users have `@biddr.invalid` emails and no passwords, so nobody can sign in as them.
- **Reset demo data** (shown once demo data exists) removes it and creates it again with times relative to now. Demo auctions close on their own like real ones (the 12-minute one closes first), so reset whenever you need the live states back.
- **Remove demo data** deletes the demo auctions with their bids and comments, the demo files (under `demo/` in both storage buckets) and the demo users. Rows not marked as demo are never touched.
- Demo auctions show a "Demo" badge and the line "This is a demo listing for testing." Real members can comment on them, but bidding is refused by the database (`DEMO_AUCTION`), and no card hold is ever requested.

### Before launch
Click **Remove demo data**, then set `ENABLE_DEMO_DATA` to `false` (or delete it) in Vercel and redeploy. With it off, the panel and its actions don't exist.

## Sign-in setup (Supabase dashboard)

Sign-in uses Supabase Auth with Google and email (a magic link plus a 6-digit code in the same email). Every flow lands on `/auth/callback`, which sends users without a username or country to `/account/setup`.

1. **Redirect URLs.** Authentication → URL Configuration:
   - Site URL: your production URL, e.g. `https://biddr.ee`.
   - Redirect URLs, add all of:
     - `https://biddr.ee/auth/callback` (production)
     - `https://*-<your-vercel-team>.vercel.app/auth/callback` (Vercel previews)
     - `http://localhost:3000/auth/callback` (local)

   A redirect URL missing here makes Supabase fall back to the Site URL, so the user loses their `next` page.
2. **Google provider.** In Google Cloud Console create an OAuth client (type *Web application*) and add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI. Then Authentication → Providers → Google: enable it and paste the client ID and secret.
3. **Magic Link email template.** Authentication → Email Templates → Magic Link: add the code so people can sign in on a different device from the one reading the email, for example:

   ```html
   <h2>Sign in to Biddr</h2>
   <p><a href="{{ .ConfirmationURL }}">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```

   Do the same in the *Confirm signup* template, since a first sign-in creates the account.
4. **Custom SMTP before launch.** Supabase's built-in mailer is rate-limited to a few emails per hour and is meant for testing only. Authentication → SMTP Settings: connect your provider (Postmark, Resend, SES…) with a sender on your own domain, and raise the email rate limit under Authentication → Rate Limits.

Make yourself admin: see [Admin panel](#admin-panel-admin).

## Verified so far

The migration was run on PostgreSQL 16 with Supabase-style stubs and these cases pass: unverified bidder, bid on own car, bid below minimum (returns the new minimum in `details`), valid bid inside the last 2 minutes (extends by 2 minutes, sets `reserve_met`), leading bidder bidding again, two simultaneous bids of the same amount (second gets `BID_TOO_LOW`), direct inserts into `bids` and updates to `auctions` refused, reserve price and Stripe ids hidden, seller reply flagged by trigger, and auction closing to `sold`. TypeScript (`strict`, `noUncheckedIndexedAccess`) and ESLint pass.

## Next phases

1. ~~`/login` (Supabase Auth: magic link + Google), profile completion (username, country, phone).~~ Done.
2. ~~`/sell` multi-step form: details and VIN, history, photo upload to Storage.~~ Done (inspections: dealer reports, `0014`).
3. ~~`/admin`: approve or reject drafts, attach the inspection PDF, set reserve, schedule.~~ Done.
4. Winner checkout: premium charge, invoices, seller payout flow.
5. i18n: wrap copy with `next-intl`, locales `en`, `et`, `lv`, `lt`.

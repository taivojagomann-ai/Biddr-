# Biddr: Baltic performance car auctions (MVP, phase 1)


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
- The winner's hold is kept by the release job. Charging the buyer's premium (capture the €500 and charge the rest, or cancel and charge the full premium) is phase 2.
- Webhook events to enable: `payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `payment_intent.payment_failed`, `payment_intent.succeeded`.

## Folder structure

```
app/
  layout.tsx                    Archivo variable font (wdth axis), skip link, header, footer
  not-found.tsx                 site 404 (Next's default forces black text)
  how-it-works/page.tsx         bidding, card hold, premium, reserve, extensions, badges, selling
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
  admin/layout.tsx              admins only; everyone else gets a 404
  admin/page.tsx                tabs: to review, scheduled, live, finished, rejected or withdrawn
  admin/auctions/[id]/          one page per auction: seller, listing, photos, inspection,
                                pricing, schedule, status actions, bids, comments
  admin/actions.ts              every admin write: requireAdmin() first, then zod, then audit
  api/admin/inspection-upload/  signed upload URL for the inspection PDF (admins only)
  api/stripe/hold/route.ts
  api/stripe/hold/confirm/route.ts
  api/stripe/webhook/route.ts
  api/stripe/release/route.ts
components/
  auction/
    auction-feed.tsx            client grid + Realtime
    auction-card.tsx, featured-lot.tsx, auction-filters.tsx
    auction-live.tsx            detail page state owner + Realtime channel
    bid-box.tsx, sticky-bid-bar.tsx, bid-modal.tsx, bid-history.tsx
    gallery.tsx, inspection-card.tsx, spec-sheet.tsx, video-player.tsx
    comments.tsx, countdown.tsx, badges.tsx
  site-header.tsx               signed-in state, profile link, sign-out; "Menu" on small screens
  mobile-menu.tsx               disclosure menu for small screens
  site-footer.tsx               the same help links on every page
  notifications/                header bell and the shared notification item
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
  baltic-time.ts                Europe/Tallinn date + time inputs <-> UTC
  demo/                         demo data: seed/remove, placeholder photos and PDF, bid generator
  site.ts                       footer links, support email and company placeholders
  bidder.ts                     server-only: bidder_status() check used by the hold route
  notifications.ts              notification wording, links and select columns (client + server)
middleware.ts                   session refresh, sends signed-out users on /sell, /admin, /account to /login
supabase/migrations/0001_init.sql
supabase/migrations/0002_service_role_grants.sql
supabase/migrations/0003_sell.sql
supabase/migrations/0004_admin.sql
supabase/migrations/0006_demo_data.sql
supabase/migrations/0007_listing_details.sql
supabase/migrations/0008_bidder_requirements.sql
supabase/migrations/0009_notifications.sql
tests/a11y/                     axe, reflow and keyboard tests + mock Supabase (npm run test:a11y)
vercel.json                     cron for hold release
```

## Accessibility

The site targets WCAG 2.2 AA. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for what was checked and what's still open. `npm run test:a11y` runs axe, reflow and keyboard checks on every page against a mock Supabase, with no keys needed.

## Environment variables

See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `CRON_SECRET` are server-only. `ENABLE_DEMO_DATA=true` turns on the admin demo-data tools; keep it `false` in production.

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

## Selling a car (`/sell`)

Signed-in members with a complete profile (username and country) submit a car in six steps: Car, History, Details, Photos, Price and inspection, Review. The listing is saved as a `draft` for an admin to review; nothing is public until an admin schedules it.

- **Draft on the device.** The form keeps all state in `sell/sell-form.tsx` and saves it to `localStorage` under `biddr:sell:v1:<user id>`, so a refresh keeps the work. "Start over" clears it and deletes the uploaded photos.
- **Photos go straight to Storage.** The browser resizes each photo (longest edge 2560 px, WebP at 0.85; JPEG where the browser can't encode WebP) and uploads it to `auction-photos/<user id>/<draft id>/<section>/<random>.webp`. Storage policies only allow writes inside the user's own folder.
- **Validated twice.** Each step is checked with the zod schemas in `lib/sell.ts` before Continue, and `submitListing` runs them all again. It also accepts only photo URLs from the user's own draft folder.
- **What is stored where.** The `auctions` row is inserted with the user's own client, so RLS and column grants apply and `status` stays `draft`. Only after that insert succeeds, the service role writes the requested reserve, inspection city and preferred dates to `auction_private` (admin-only) and sets `has_reserve`. If that second write fails, the draft is deleted so the seller can submit again.
- **One open listing per VIN.** A VIN that is already a draft, scheduled or live is refused with "This car is already listed or waiting for review."
- **Structured details.**
  - The Car step asks for body style, interior colour, number of owners, seller type (dealers give a company name and registry code) and registration.
  - The Details step collects highlights (3 to 10), equipment, modifications (or "factory specification"), known flaws (or "not aware of any flaws"), service history rows (month, mileage, work, workshop), items included and seller notes.
  - Every list allows at most 40 items of 300 characters each; the database enforces the same limits (`0007`).
  - Drafts saved before the Details step existed open on that step.
- **The auction page** shows, under the gallery: highlights, the inspection, specifications, equipment, modifications, known flaws, service history (a table, newest first), items included, seller notes, then the video. Empty optional sections are hidden, and lists longer than 8 items get a "Show all" button.
- `/account/listings` shows the member's own listings with their status. The header links to it as "My listings".

Photos from a draft that is never submitted stay in the bucket. Clean them up later with a scheduled job that removes folders with no matching auction.

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
- **Per auction** (`/admin/auctions/<id>`): every listing detail is editable. Admins aren't held to the seller-only rules (minimum highlights, declaring modifications and flaws), so older listings can be saved. Also on the page: seller contact details (email from Supabase Auth, phone and full name from `profiles`) and their requested reserve and inspection preferences. The admin can edit the listing text, remove photos or change the cover, enter the inspection partner, date and highlights, and upload the report PDF. They also set the starting bid, increment and reserve, set the schedule in Baltic time, and see all bids and delete comments.
- **Status changes**: approve and schedule or reject (with a reason the seller sees) a draft. Move a scheduled auction back to review, or withdraw it. Extend a live auction (+1 hour, +1 day or a custom later time), or withdraw it, which cancels the bids and releases the card holds straight away. Every destructive step asks for confirmation and says what will happen.
- **Rules the database enforces**: `admin_set_reserve` and `admin_set_schedule` lock the auction row like `place_bid`. While an auction is live, the reserve can only go down and the end can only move later. A restored car can't be scheduled without an inspection partner and report. Auctions run at most 7 days because card holds expire after about 7 days.
- **Security**: browser clients still can't write status, price or schedule columns. Every admin write is a server action or route handler that calls `requireAdmin()` first, re-validates its input with zod, uses the service-role client only after that, and records the change in `admin_actions`. The inspection PDF goes straight from the browser to Storage through a signed upload URL the server creates for that auction only.

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

## Demo data (for testing)

The admin panel can fill the site with six example auctions, with bids, comments and placeholder photos, and remove them again with one click. Use it to try the site before real cars are listed.

### Turn it on
1. Run `supabase/migrations/0006_demo_data.sql` in the Supabase SQL Editor (once).
2. In Vercel: Project → Settings → Environment Variables, add `ENABLE_DEMO_DATA` with the value `true`, then redeploy. Locally, put `ENABLE_DEMO_DATA=true` in `.env.local`.
3. Sign in as an admin and open **Admin**. The **Demo data** panel is at the bottom of the page.

### Use it
- **Load demo data** creates 1 demo seller and 5 demo bidders, and six auctions marked "Demo":
  - live and closing in 12 minutes, 21 bids, reserve met;
  - live, ending in 26 hours, 6 bids, reserve not met yet;
  - live with no reserve and no bids;
  - scheduled for tomorrow 12:00;
  - sold yesterday (a restored car with before photos and a demo report PDF);
  - ended 3 days ago below its reserve.

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
2. ~~`/sell` multi-step form: details and VIN, history, photo upload to Storage, inspection city (Tallinn, Riga, Vilnius) stored in `auction_private.inspection_city`.~~ Done.
3. ~~`/admin`: approve or reject drafts, attach the inspection PDF, set reserve, schedule.~~ Done.
4. Winner checkout: premium charge, invoices, seller payout flow.
5. i18n: wrap copy with `next-intl`, locales `en`, `et`, `lv`, `lt`.

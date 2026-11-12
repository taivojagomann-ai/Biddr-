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
  layout.tsx                    Archivo variable font (wdth axis), header
  globals.css                   palette tokens, shadcn variables, .font-wide
  page.tsx                      Home: filters + live feed
  auctions/[id]/page.tsx        Auction detail (server data load)
  auctions/[id]/not-found.tsx
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
  ui/                           shadcn/ui: button, dialog, input, tabs
hooks/use-server-clock.ts       shared 1 Hz ticker + server clock offset
lib/
  supabase/client.ts, server.ts
  stripe.ts, holds.ts, pricing.ts, errors.ts, format.ts, types.ts, utils.ts
middleware.ts                   session refresh, guards /sell and /admin
supabase/migrations/0001_init.sql
vercel.json                     cron for hold release
```

## Environment variables

See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `CRON_SECRET` are server-only.

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

Make yourself admin: `update profiles set role = 'admin' where id = '<your user id>';`

## Verified so far

The migration was run on PostgreSQL 16 with Supabase-style stubs and these cases pass: unverified bidder, bid on own car, bid below minimum (returns the new minimum in `details`), valid bid inside the last 2 minutes (extends by 2 minutes, sets `reserve_met`), leading bidder bidding again, two simultaneous bids of the same amount (second gets `BID_TOO_LOW`), direct inserts into `bids` and updates to `auctions` refused, reserve price and Stripe ids hidden, seller reply flagged by trigger, and auction closing to `sold`. TypeScript (`strict`, `noUncheckedIndexedAccess`) and ESLint pass.

## Next phases

1. `/login` (Supabase Auth: magic link + Google), profile completion (username, country, phone).
2. `/sell` multi-step form: details and VIN, history, photo upload to Storage, inspection city (Tallinn, Riga, Vilnius) stored in `auction_private.inspection_city`.
3. `/admin`: approve or reject drafts, attach the inspection PDF, set reserve, schedule. Admin writes go through server actions using the service-role client after checking `role = 'admin'`, because column grants intentionally stop browser clients from touching money and status columns.
4. Winner checkout: premium charge, invoices, seller payout flow.
5. i18n: wrap copy with `next-intl`, locales `en`, `et`, `lv`, `lt`.

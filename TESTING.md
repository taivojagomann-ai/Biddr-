# Testing Biddr

Biddr has two automated test suites and one manual checklist.

| What | Command | Runs against |
| --- | --- | --- |
| End-to-end tests (every process on the site) | `npm run test:e2e` | A local Supabase stack, local mail catcher and stripe-mock |
| Migration check (every migration can run twice) | `npm run test:migrations` | The same local database |
| Accessibility scan with a fake database | `npm run test:a11y` | A small mock of Supabase |
| Things a computer can't check | [MANUAL_TESTS.md](MANUAL_TESTS.md) | The real site, by a person |

All of them run on every pull request and on every push to `main` (`.github/workflows/e2e.yml`). A pull request with a failing test shows a red cross.

## Safety: nothing touches production

- The tests only talk to `127.0.0.1` / `localhost`. Both the test helpers (`e2e/support/env.ts`) and the migration script refuse anything else.
- No real keys are used. The Supabase keys are the public demo keys every local Supabase stack uses. The Stripe key is the fake `sk_test_e2eonly`, sent to stripe-mock, never to Stripe. `E2E_STRIPE_MOCK=true` only works with a test key, so it can't be switched on in production by accident.
- Emails go to Mailpit, the mail catcher in the local stack. Nothing is sent to a real inbox.
- Every test creates its own users and auctions, so tests never depend on each other or on existing data.

## Running the end-to-end tests on your computer

You need Node.js 20, Docker Desktop (running) and about 5 GB of free disk space.

1. Install the packages and the test browser (once):

   ```bash
   npm install
   ```

   ```bash
   npx playwright install chromium
   ```

2. Start the local Supabase stack. The first start downloads the Docker images and takes a few minutes. It applies every migration in `supabase/migrations` to a new, empty database:

   ```bash
   npx supabase@2.122.1 start
   ```

3. Start stripe-mock (a fake Stripe that runs on your computer):

   ```bash
   docker run -d --rm --name biddr-stripe-mock -p 12111:12111 stripe/stripe-mock:v0.206.0
   ```

4. Run the tests. The first run builds the site (`next build`) into `.next-e2e` and starts it on http://localhost:3100:

   ```bash
   npm run test:e2e
   ```

   To watch the tests run and step through them, use the Playwright UI instead:

   ```bash
   npm run test:e2e:ui
   ```

5. If something fails, open the report. It has a screenshot, and a trace of every failed test that you can step through:

   ```bash
   npx playwright show-report e2e-report
   ```

6. Check that every migration can run twice:

   ```bash
   npm run test:migrations
   ```

7. When you're done:

   ```bash
   npx supabase@2.122.1 stop
   ```

   ```bash
   docker stop biddr-stripe-mock
   ```

Tips:

- While the local stack runs, you can read every sign-in email the tests sent at http://127.0.0.1:54324 (Mailpit).
- To run one area only, add the file name: `npm run test:e2e -- 05-bidding`.
- To run only the desktop (Berlin) or phone (Tallinn) project: `npm run test:e2e -- --project=desktop-berlin`.
- After changing app code, stop any server you started yourself on port 3100; the tests rebuild the site when nothing is running there.
- `scripts/e2e-server.sh` builds and starts the test server by hand, with the same settings the tests use.

## How the tests are set up

- **Projects.** Every test runs twice: on a desktop Chromium at 1440 × 900 in the Europe/Berlin time zone, and on a phone (Pixel 7, 390 × 844) in the Europe/Tallinn time zone. Layout checks also run at 320 px. The database-only areas (1 and 11) run on desktop only.
- **Users.** `e2e/global-setup.ts` creates the named users through the Supabase admin API at the start of each run: an admin with a two-factor (TOTP) app, two sellers (private and dealer), three bidders and one user with an unfinished profile. Tests sign in by setting a real session cookie, so they don't have to go through the sign-in form each time; the admin also passes two-step verification with a code generated from its authenticator secret (otplib). Area 2 tests the sign-in form itself with real emails from Mailpit.
- **Time.** Tests don't wait for clocks. They set start and end times in the data and run the scheduled SQL jobs (`advance_auction_states`, `notify_watch_ending_soon`, `inspection_decision_job`) directly.
- **Card holds.** stripe-mock answers the Stripe calls. A successful card check is simulated with a signed `payment_intent.amount_capturable_updated` webhook (a PaymentIntent in `requires_capture`). The real card form (Stripe Elements) is in the manual checklist. stripe-mock can't validate one field the app sends (`payment_method_types`), so the test client drops that single field. Real Stripe always gets the full request.
- **Files.** `e2e/specs/` has one file per area. `e2e/support/` has the helpers that create users, auctions, holds and bids, read emails, and fill in the sell form.

## What each area covers

| # | File | Covers |
| --- | --- | --- |
| 1 | `01-database-security` | Row-level security and column grants: private data, other people's holds, role and verification fields, seller-locked columns, direct bid inserts, draft visibility, storage folders, admin and cron routes, admin rights only after two-step verification |
| 2 | `02-auth-profile` | Email code and magic link (from Mailpit), wrong code, unsafe redirects, profile setup and validation (27 EU countries), sign out, protected pages |
| 3 | `03-home` | Tabs and their order, Ending next, search (codes, spaces, aliases, accents, years), suggestions by keyboard, country and history filters, New badge, two cards per row at 390 and 320 px, live price updates |
| 4 | `04-auction-page` | Inspected and accident-repaired cars, dealer sellers, the View on map link, seller card (stats, no private details), info tips, sharing, Open Graph tags, watching, previews of drafts and rejected listings |
| 5 | `05-bidding` | Bid dialog steps in order and skipped when done, terms (both boxes, version stored), card check through a signed webhook, every place_bid rule and error, anti-sniping, two equal bids at once, buyer's premium at €5,000/€7,000/€70,000/€100,000, live updates across two browsers, outbid notice, auto-watch |
| 6 | `06-comments` | Who can post, questions and replies, Seller and Biddr team labels, live updates, links to a comment, database rules |
| 7 | `07-sell-flow` | Validation on every step, draft kept on the device, preview, private and dealer sellers, accident-repaired cars, dealer inspection report (private upload), duplicate VIN |
| 8 | `08-admin` | Admin sign-in (the admin link and Google-only dialog, two-step code, first-time authenticator setup), queue and tabs, approve (checklist), reject, move back to review, report accept/reject, the seller's choice and the daily deadline job, pricing, extend, withdraw, withdrawal requests, activity log, demo data |
| 9 | `09-seller-dashboard` | My listings statuses, withdrawing before bidding opens, requesting a withdrawal while live |
| 10 | `10-notifications-watchlist` | Every notification type, never about your own action, none for demo listings, no duplicates, the live bell, mark as read, watchlist tabs and remove |
| 11 | `11-lifecycle` | `advance_auction_states` (live, sold, reserve not met, ended), bids after the end, hold release against stripe-mock |
| 12 | `12-copy-consistency` | Forbidden phrases from DECISIONS.md in the code and on every page, title and meta description, the fixed bidding numbers, navigation names, times in the viewer's zone with its abbreviation (CET in Berlin, EET in Tallinn) |
| 13 | `13-accessibility` | axe (WCAG 2.2 AA) on every page at desktop and phone size, and the bid and sell flows done with the keyboard only |

Tests marked `test.fixme` are known gaps that need a product decision or a feature that isn't built yet; each one says why in a comment.

# Accessibility

Target: **WCAG 2.2 level AA**. Last full pass: November 2026.

## What was checked

Every page, at desktop width and on a phone:

- **Public:** `/` (including filters and empty results), `/auctions/[id]` (live, restored, upcoming and sold), the bid dialog, `/login` (including the error and "check your inbox" states), `/how-it-works`, `/terms`, `/privacy`, and the 404 page.
- **Signed in:** `/account/setup`, `/account/listings`, `/sell` (all five steps, plus the error state), `/sell/submitted`, `/admin` and `/admin/auctions/[id]` (draft and live), and its confirmation dialogs.

Each page was checked for:
- visible labels on every input;
- errors that are announced and say how to fix them;
- heading order and alt text;
- dialog focus;
- keyboard-only use;
- polite announcements for status changes;
- information that isn't conveyed by colour alone;
- reflow at 320 px (the same as 400% zoom at 1280 px);
- the four issues below.

## What passes

The automated suite (`npm run test:a11y`) runs 110 checks, desktop and phone. All pass:

- **axe-core**, WCAG 2.0, 2.1 and 2.2 A/AA rules: no violations at all on any page or dialog listed above. The test fails on serious or critical ones and logs anything lower.
- **Reflow:** no page scrolls sideways at 320 px wide.
- **Keyboard:**
  - The skip link is the first Tab stop.
  - The bid dialog returns focus to the button that opened it.
  - The phone menu opens with Enter and closes with Escape, returning focus to the button.
  - Tabbing through the auction page and the sell form on a phone, no focused control is hidden behind the sticky header or bottom bar.

### Issues fixed in this pass

| WCAG | Issue | Fix |
| --- | --- | --- |
| 1.4.11 Non-text contrast | Input, select, textarea and outline-button borders were `#27272A` (about 1.4:1) | New `border-field` token `#71717A`: 4.2:1 on the page background, 3.9:1 on panels. `#27272A` (`border-line`) is now only for dividers and card edges. Stripe's card field uses it too. |
| 2.4.11 Focus not obscured | The sticky header and the phone bid and sell bars could cover the focused element | `scroll-padding-top` for the header. `scroll-padding-bottom` and body padding whenever a `[data-sticky-bottom]` bar is on screen. |
| 2.5.8 Target size | "Reply", "Cancel reply", "Show all bids", small buttons and filter tabs were 16–32 px tall | Every button is at least 36 px tall. On touch screens (`pointer: coarse`), buttons, links and selects are 44 px. |
| 3.2.6 Consistent help | No help or contact on most pages | A footer on every page, always in this order: How it works, Help and contact, Terms, Privacy, then company details. |
| 2.5.3 Label in name | Quick-bid buttons showed "+€250" but were named "Set bid to €52,750" | The visible text comes first in the name: "+€250, sets your bid to €52,750". |
| 1.4.3 Contrast | The destructive confirm button was 4.39:1 | Darker red, about 6:1. |
| 1.4.10 Reflow | The signed-in header was 101 px too wide at 320 px; admin date fields overflowed | A "Menu" disclosure button on small screens; fieldsets can now shrink. |
| 4.1.3 Status messages | Outbid, new-bid and clock-extension messages were only in the desktop sidebar, so phone users heard and saw nothing; upload progress announced every percent | One polite live region per auction page, and an "outbid" label in the phone bid bar. One upload summary per photo section, announced when uploads finish or fail. Comment posted and admin saves are announced. |
| 2.4.3 Focus order | Focus was lost after closing the bid dialog or changing step in the sell form | Focus returns to the opener. A step change moves focus to the new step's heading. A failed profile save focuses the first field to fix. |
| 1.3.1 / 3.3.2 Labels | Filter selects and the comment box had only screen-reader labels | Visible labels. |
| 1.4.1 Use of colour | The highest bid in the history was marked only by colour | A "Highest" tag. |
| 2.4.1 Bypass blocks | No skip link | "Skip to main content" is the first focusable element. |
| 1.1.1 Text alternatives | Card photos repeated the title next to them | `alt=""` on those. Gallery photos keep descriptive alt text. |
| Other | Next's built-in 404 page forced black text; the countdown's `aria-label` hid the time from screen readers | A custom 404 page; the label is removed. |

## Known gaps

- **No screen reader testing yet.** This pass used axe, scripted keyboard tests and a code review. Before launch, test the bid flow and the sell form with VoiceOver on iOS and NVDA with Firefox.
- **Stripe card form.** It's a third-party iframe. Its accessibility is Stripe's, and the test can't reach it (it uses a mock Stripe key). Only its border colour is set here.
- **Admin form errors** show under each field and are announced in the section's message, but the inputs aren't linked to their own error with `aria-describedby`, as they are on public forms.
- **Admin time inputs** have screen-reader labels inside a visibly labelled group, not a visible label each. List editors (highlights, equipment, flaws and so on) show a visible number per row, named "Highlight 1" and so on for screen readers.
- **The video embed** can be partly under the phone bid bar when it gets focus. The keyboard test skips iframes: in the offline test browser the YouTube player can't load, so there is no control inside it to focus and scroll into view. That meets 2.4.11 (it's never entirely hidden); smaller controls are always fully visible.
- **Text spacing (1.4.12)** and **200% text-only zoom** haven't been tested automatically. Layouts use relative units, and the 320 px reflow test covers zooming the whole page.
- **Date and time pickers** in the admin follow the browser's locale, not en-GB.
- **Placeholders** to fill before launch: the support email and company details (`lib/site.ts`), and the Terms and Privacy pages. The "Help and contact" link is `mailto:[support email]` until then.
- **"Confirm your card once"** on the home page: the card hold is placed once per car you bid on, and the line under that step says so.

## How to run the test

```bash
npm run test:a11y
```

This:
1. starts a mock Supabase (`tests/a11y/mock-supabase.mjs`, port 54329) with sample auctions, comments, bids and a signed-in admin user;
2. builds the app against it and serves it on port 3210;
3. runs `tests/a11y/pages.spec.ts` in Chromium at desktop and phone sizes.

It needs no real Supabase or Stripe keys, so it can run in CI as is.

The build goes into `.next` with the mock's URL baked in, so run `npm run build` again before deploying from the same folder. Playwright needs Chromium: run `npx playwright install chromium` if it isn't installed. To add a page, add its path to `PUBLIC_PAGES` or `SIGNED_IN_PAGES` in the spec, and any data it needs to the mock.

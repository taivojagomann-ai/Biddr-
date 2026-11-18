# Manual tests

The automated tests (see [TESTING.md](TESTING.md)) can't check these things, because they need a real Google account, a real card form from Stripe, a real inbox, a real phone or a real social app. Go through this list before a launch and after any change to sign-in, payments, emails or sharing.

Use the **staging or preview site with Stripe in test mode**, never real cards or real money. Note the date, the site address, the device and browser, and the result of each step. If something fails, write down what you expected, what happened, and take a screenshot.

## 1. Google sign-in

1. Open the site in a private window and choose **Sign in**.
2. Choose **Continue with Google** and sign in with a Google account that has never used Biddr.
   - [ ] You come back to Biddr signed in, on the profile setup page.
3. Fill in the profile and save.
   - [ ] You end up on the page you started from.
4. Sign out, then sign in with Google again.
   - [ ] You go straight in, without the profile page.
5. Cancel on Google's screen.
   - [ ] You're back on the Biddr sign-in page with a clear message, not an error page.

## 2. Admin sign-in with Google and two-step verification

Use a Google account whose Biddr profile has the admin role, and a phone with an authenticator app.

1. On the sign-in page, choose **Sign in as an admin** (the small link at the bottom).
   - [ ] A dialog opens with **Continue with Google** as the only option.
2. Sign in with Google.
   - [ ] You land on **Two-step verification**.
   - [ ] The first time, it shows a QR code. Scan it with the authenticator app and enter the 6-digit code; you reach the admin panel.
3. Sign out and sign in as an admin again.
   - [ ] This time it only asks for the code (no QR code).
4. Enter a wrong code.
   - [ ] You get a clear message and can try again.
5. Sign in as the admin through the normal email sign-in, then open `/admin`.
   - [ ] You're asked for the code before the panel opens.
6. Sign in with Google as someone who isn't an admin, via **Sign in as an admin**.
   - [ ] You end up on the home page, signed in as a normal member, with no admin panel.

## 3. Card hold with a Stripe test card

Stripe must be in **test mode** (the keys start with `pk_test_` and `sk_test_`).

1. Sign in as a bidder with a complete profile and open a live auction.
2. Choose **Bid**, accept the bidding terms, and on **Confirm your card** enter:
   - card `4242 4242 4242 4242`, any future expiry date, any CVC, any postcode.
   - [ ] The dialog moves on to **Confirm your bid**.
   - [ ] In the Stripe dashboard (test mode), **Payments** shows a €500 payment that is **Uncaptured**, with the description "Bidding security hold: …".
   - [ ] Every page shows the yellow "Test mode: no real payments. Use Stripe test cards." banner.
   - [ ] In the admin, the auction's **Payments** section lists your hold as **Held**, with a link to the payment in Stripe, and the Stripe event `payment_intent.amount_capturable_updated` as **Handled**.
3. Place a bid.
   - [ ] It shows as the high bid.
4. Open a second live auction and bid again.
   - [ ] You're asked for the card again: a hold is per auction.
5. After an auction you lost has ended, wait up to 5 minutes for the release job.
   - [ ] In Stripe, the hold shows as **Canceled**, and the bank statement never shows a charge.
   - [ ] In the admin's **Payments** section, the hold shows as **Released**.

## 4. 3-D Secure card

1. Repeat section 3 with the 3-D Secure test card `4000 0027 6000 3184`.
   - [ ] Stripe's authentication window opens.
2. Choose **Complete**.
   - [ ] The dialog moves on to **Confirm your bid**.
3. Try again on another auction, and this time choose **Fail** in the authentication window.
   - [ ] You see a clear message that the card wasn't confirmed, and you can try again. (If your browser was sent to the bank's page and back, the auction page says "Your bank didn't approve the €500 hold, so nothing was held.")
   - [ ] No hold is left behind in Stripe.
4. Try the declined card `4000 0000 0000 0002`.
   - [ ] You see "Your card was declined. Nothing was held. Try again or use another card." and can enter another card in the same window.

## 5. Real emails in a real inbox

Use a real address you can read (Gmail, Outlook and Apple Mail if possible).

1. Sign in with the email code.
   - [ ] The email arrives within a minute, not in spam.
   - [ ] The subject and sender name say Biddr.
   - [ ] The 6-digit code works, and so does the **Sign in** link (open it on the same device).
   - [ ] The email reads well on a phone and in dark mode.
2. Use the link twice, or use a code that is more than an hour old.
   - [ ] You get a clear "expired" message and can ask for a new one.
3. Check that the site doesn't promise email notifications anywhere unless email sending for notifications has actually been set up.

## 6. A real phone

Use at least one iPhone (Safari) and one Android phone (Chrome).

1. Home page:
   - [ ] Two cards per row, no sideways scrolling.
   - [ ] The tabs scroll sideways if they don't fit.
2. Auction page:
   - [ ] Photos swipe.
   - [ ] Tapping a photo opens it full screen. Swipe between photos, pinch and double-tap to zoom, move around a zoomed photo with one finger, swipe down to close.
   - [ ] The phone's back button (Android) or back swipe (iPhone) closes the full-screen view and stays on the car.
   - [ ] The close button isn't under the notch or the status bar.
   - [ ] The sticky **Place bid** bar doesn't cover the last part of the page.
   - [ ] The countdown ticks.
3. Bid dialog:
   - [ ] The keyboard doesn't hide the amount field or the **Place bid** button.
   - [ ] The Stripe card form works, including Apple Pay or Google Pay if they're shown.
4. Sell form:
   - [ ] **Add photos** offers the camera and the photo library.
   - [ ] Photos from the phone (HEIC on iPhone) upload, and their progress shows.
   - [ ] Leaving the form and coming back keeps your answers.
5. Times are shown in the phone's own time zone, with its abbreviation (for example EET in Tallinn).
6. Turn on the screen reader (VoiceOver or TalkBack) and place a bid.
   - [ ] Every button is read out with a clear name.
   - [ ] "You've been outbid" is announced.

## 7. Sharing a link

Use a live auction with photos.

1. Share it in **WhatsApp**:
   - [ ] The preview shows the car's photo, title and description.
   - [ ] Tapping it opens the auction.
2. Share it on **Facebook**:
   - [ ] Paste the link into the post box: the preview shows the photo, title and description.
   - [ ] If it shows something old, run the link through Facebook's Sharing Debugger and choose **Scrape Again**.
3. On a phone, use **Share** on the auction page:
   - [ ] The phone's own share sheet opens.
4. On a computer, use **Share** → **Copy link**:
   - [ ] The link is copied and a confirmation shows.
5. Share a draft or rejected listing (seller's preview link) to someone who isn't signed in:
   - [ ] They get "not found", and no preview of the car appears in the chat.
6. On the auction page, tap **View on map** next to Location:
   - [ ] Google Maps opens (the app on a phone) and shows the city, not an exact address.

## 8. Winning, paying the buyer's premium and the contact exchange (Stripe test mode)

Stripe must be in **test mode** (every page shows the yellow test-mode banner), migrations 0021 and 0022 must be run, and the two Vault secrets from PR "Stripe test mode: card hold flow" must be set, so the jobs run every few minutes.

**Accounts:** a seller (S), a winner (W) and a second bidder (B), each with a complete profile including full name and phone, in three different browsers or private windows. Plus an admin.

**Premium reminder:** 5% of the winning bid, at least €350, at most €3,500. Up to €500 comes from the winner's €500 hold; the rest is charged to the same card.

### 8.1 Premium under €500 (taken from the hold)
1. S lists a car; the admin approves it and, under Schedule, sets it to start now and end in about 10 minutes.
2. B bids with card `4242 4242 4242 4242` (€5,000). W bids with `4242 4242 4242 4242` (€6,000). The premium is €350.
3. Wait for the end, then up to 5 minutes for the jobs.
   - [ ] W's **My purchases** (account menu) shows the car, winning bid €6,000, premium €350, "Taken from your card hold €350", "Charged to your card €0", status **Paid** and a **View invoice BID-…** link.
   - [ ] The invoice opens in a new tab, and the browser's download button saves it as `Biddr-invoice-BID-….pdf`. It shows: Biddr OÜ's details, W's name, "Buyer's premium: <car>", €350.00 including VAT 24% (Estonia), "Taken from the card hold €350.00", and the red "Test mode" line.
   - [ ] W sees S's full name, phone and email, with the note "Arrange payment for the car and the handover directly with each other."
   - [ ] S's **My listings** shows W's full name, phone and email on the sold car.
   - [ ] Both got a notification ("Buyer's premium paid…").
   - [ ] **Stripe dashboard → Payments:** W's hold "Bidding security hold: …" is **Succeeded** for €350 (partially captured: the other €150 was released); B's hold is **Canceled**.
   - [ ] **Admin → Payments:** the car is under **Paid**, with a "Card hold in Stripe" link.

### 8.2 Premium over €500 (hold plus a second charge)
1. As in 8.1, but W wins with a €12,000 bid (premium €600).
   - [ ] My purchases: "Taken from your card hold €500", "Charged to your card €100", **Paid**.
   - [ ] Stripe: the hold is **Succeeded** €500, and a new payment "Buyer's premium: …" is **Succeeded** €100, on the same card and customer.

### 8.3 The bank asks the winner to confirm (3-D Secure)
1. W places the hold with `4000 0027 6000 3184` (choose **Complete** in the pop-up) and wins with a €12,000 bid.
   - [ ] After the jobs run, My purchases shows "Your bank needs you to confirm the payment.", a **Please pay by** date 72 hours away and a **Complete payment** button. No seller contact details yet. S's My listings says it's waiting for the buyer.
   - [ ] W got a notification asking to complete the payment.
   - [ ] Admin → Payments → **Needs the winner** lists it.
2. W selects **Complete payment**, enters `4000 0027 6000 3184` again and chooses **Complete**.
   - [ ] Status becomes **Paid**, and the contact details appear for both.
   - [ ] Stripe: the "Buyer's premium" payment is **Succeeded** for €100.
3. Repeat on another car, choosing **Fail** in the pop-up at step 2.
   - [ ] A clear message says nothing was charged, and **Complete payment** still works afterwards.

### 8.4 Admin tools
1. On a paid car, Admin → Payments → **Refund premium** → confirm.
   - [ ] Status **Refunded**. Stripe shows the hold payment and any "Buyer's premium" payment as **Refunded**.
   - [ ] The auction's admin activity log shows `payment.refund`, with the credit note's number.
   - [ ] W's My purchases shows **View credit note BID-…** next to the invoice; the credit note shows −€… and "This credit note cancels invoice BID-…".
   - [ ] **Admin → Invoices** lists the invoice and the credit note for this month, the VAT totals, and **Download CSV for the accountant** downloads both rows.
2. On a car that needs the winner (8.3 before paying), choose **Mark as cancelled**, give a reason and confirm.
   - [ ] Status **Cancelled**. Nothing more is charged, and no contact details are shown.
3. **Retry charge** on a car that needs the winner.
   - [ ] A message says the bank needs the winner to confirm again (the same 3-D Secure card).

### Not testable with Stripe test cards
- A hold that expired after 7 days (the whole premium is charged to the saved card) and a card declined after the hold was placed are covered by the automated tests (`e2e/specs/17-buyer-premium.spec.ts`).

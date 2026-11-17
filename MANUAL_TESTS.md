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
3. Place a bid.
   - [ ] It shows as the high bid.
4. Open a second live auction and bid again.
   - [ ] You're asked for the card again: a hold is per auction.
5. After an auction you lost has ended, run the release job (or wait for it, if it's scheduled).
   - [ ] In Stripe, the hold shows as **Canceled**, and the bank statement never shows a charge.

## 4. 3-D Secure card

1. Repeat section 3 with the 3-D Secure test card `4000 0027 6000 3184`.
   - [ ] Stripe's authentication window opens.
2. Choose **Complete**.
   - [ ] The dialog moves on to **Confirm your bid**.
3. Try again on another auction, and this time choose **Fail** in the authentication window.
   - [ ] You see a clear message that the card wasn't confirmed, and you can try again.
   - [ ] No hold is left behind in Stripe.
4. Try the declined card `4000 0000 0000 0002`.
   - [ ] You see a clear message and can try another card.

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
   - [ ] Photos swipe sideways with the finger, and scrolling the page up and down over a photo still works.
   - [ ] Tapping a photo opens the large viewer. Swipe between photos, pinch and double-tap to zoom, move around a zoomed photo with one finger, swipe down to close.
   - [ ] The phone's back button (Android) or back swipe (iPhone) closes the viewer and stays on the car.
   - [ ] The viewer's close button isn't under the notch or the status bar.
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

// Area 1: database security. Talks to the local database directly with the
// anon key and with signed-in users' clients, exactly as a browser could.
import { test, expect, signIn } from "../support/fixtures";
import { APP_URL, CRON_SECRET } from "../support/env";
import { anonDb, userDb } from "../support/supabase";
import { authorizeHold, createAuction, createUser, iso, DAY, service } from "../support/factory";

test.describe("database security", () => {
  test("visitors and other users can't read private auction data, holds, admin logs or private profile fields", async () => {
    const seller = await createUser({ role: "seller" });
    const other = await createUser();
    const auction = await createAuction({ seller, reserve: 25_000 });
    await service().from("auction_private").update({ dealer_report_paths: ["x/y/z.pdf"] }).eq("auction_id", auction.id);
    const holder = await createUser();
    await authorizeHold(holder, auction.id);
    await service().from("admin_actions").insert({ auction_id: auction.id, action: "e2e.check", details: {} });

    for (const [who, db] of [
      ["visitor", anonDb()],
      ["other user", await userDb(other.email)],
      ["the seller", await userDb(seller.email)],
    ] as const) {
      const priv = await db.from("auction_private").select("reserve_price, dealer_report_paths").eq("auction_id", auction.id);
      expect(priv.data ?? [], `${who} reads auction_private`).toEqual([]);
      const log = await db.from("admin_actions").select("id").eq("auction_id", auction.id);
      expect(log.data ?? [], `${who} reads admin_actions`).toEqual([]);
    }

    // Phone and full name are column-protected for everyone, even the profile's owner reading others.
    const otherDb = await userDb(other.email);
    const phone = await otherDb.from("profiles").select("phone").eq("id", seller.id);
    expect(phone.error, "phone is readable").not.toBeNull();
    const fullName = await anonDb().from("profiles").select("full_name").eq("id", seller.id);
    expect(fullName.error, "full_name is readable").not.toBeNull();
    const publicCols = await anonDb().from("profiles").select("id, username, country").eq("id", seller.id).single();
    expect(publicCols.data?.username).toBe(seller.username);

    // Someone else's card holds.
    const holds = await otherDb.from("bid_holds").select("id").eq("auction_id", auction.id);
    expect(holds.data ?? []).toEqual([]);
    const anonHolds = await anonDb().from("bid_holds").select("id").eq("auction_id", auction.id);
    expect(anonHolds.data ?? []).toEqual([]);
  });

  test("users can't promote themselves, verify themselves, fake terms or touch money and status columns", async () => {
    const user = await createUser({ terms: false });
    const db = await userDb(user.email);
    for (const values of [{ role: "admin" }, { is_verified_bidder: true }, { bidding_terms_version: "x" }, { bidding_terms_accepted_at: new Date().toISOString() }]) {
      const { error } = await db.from("profiles").update(values).eq("id", user.id);
      expect(error, `update ${Object.keys(values)[0]}`).not.toBeNull();
    }
    const { data: me } = await service().from("profiles").select("role, is_verified_bidder, bidding_terms_version").eq("id", user.id).single();
    expect(me).toEqual({ role: "user", is_verified_bidder: false, bidding_terms_version: null });

    // A seller can't change the price, status or schedule of their own listing.
    const seller = await createUser({ role: "seller" });
    const sellerDb = await userDb(seller.email);
    const draft = await createAuction({ seller, status: "draft" });
    for (const values of [
      { status: "live" },
      { current_bid: 999_999 },
      { starting_bid: 1 },
      { reserve_met: true },
      { leading_bidder_id: seller.id },
      { starts_at: iso(0), ends_at: iso(DAY) },
      { inspection_type: "authorised_dealer" },
      { is_demo: true },
    ]) {
      const { error } = await sellerDb.from("auctions").update(values).eq("id", draft.id);
      expect(error, `seller updates ${Object.keys(values)[0]}`).not.toBeNull();
    }
  });

  test("bids can only be placed through place_bid, not inserted directly", async () => {
    const seller = await createUser({ role: "seller" });
    const auction = await createAuction({ seller });
    const bidder = await createUser({ verifiedBidder: true });
    await authorizeHold(bidder, auction.id);
    const db = await userDb(bidder.email);
    const { error } = await db.from("bids").insert({ auction_id: auction.id, bidder_id: bidder.id, amount: 50_000, stripe_payment_intent_id: "pi_fake" });
    expect(error).not.toBeNull();
    const { count } = await service().from("bids").select("id", { count: "exact", head: true }).eq("auction_id", auction.id);
    expect(count).toBe(0);
  });

  test("drafts and rejected listings are visible only to their seller and admins", async ({ seed }) => {
    const seller = await createUser({ role: "seller" });
    const draft = await createAuction({ seller, status: "draft" });
    const rejected = await createAuction({ seller, status: "rejected" });
    const ids = [draft.id, rejected.id];
    const visible = async (db: Awaited<ReturnType<typeof userDb>> | ReturnType<typeof anonDb>) =>
      ((await db.from("auctions").select("id").in("id", ids)).data ?? []).length;
    expect(await visible(anonDb())).toBe(0);
    expect(await visible(await userDb((await createUser()).email))).toBe(0);
    expect(await visible(await userDb(seller.email))).toBe(2);
    // Admins see them once they've passed two-step verification (see the aal1 test below).
    expect(await visible(await userDb(seed.admin.email, { totpSecret: seed.admin.totpSecret }))).toBe(2);
  });

  test("storage: no one can upload into another user's folder or read private inspection uploads", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const ownerDb = await userDb(owner.email);
    const intruderDb = await userDb(intruder.email);
    const file = new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" });
    const path = `${owner.id}/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;

    expect((await ownerDb.storage.from("inspection-uploads").upload(path, file)).error).toBeNull();
    const foreign = `${owner.id}/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;
    expect((await intruderDb.storage.from("inspection-uploads").upload(foreign, file)).error).not.toBeNull();
    expect((await intruderDb.storage.from("auction-photos").upload(`${owner.id}/x/exterior/a.webp`, new Blob(["x"], { type: "image/webp" }))).error).not.toBeNull();

    // Not public, not readable by others, no signed URL for others.
    const publicUrl = anonDb().storage.from("inspection-uploads").getPublicUrl(path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
    expect((await intruderDb.storage.from("inspection-uploads").download(path)).error).not.toBeNull();
    expect((await intruderDb.storage.from("inspection-uploads").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await anonDb().storage.from("inspection-uploads").download(path)).error).not.toBeNull();
  });

  test("admin route handlers and the hold-release job refuse visitors", async ({ request }) => {
    const auction = await createAuction({ seller: await createUser({ role: "seller" }) });
    // Visitors.
    expect((await request.get(`${APP_URL}/api/admin/inspection-file?auction=${auction.id}&file=0`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.post(`${APP_URL}/api/admin/inspection-upload`, { data: { auctionId: auction.id } })).status()).toBe(404);
    // The hold-release job needs its secret.
    expect((await request.get(`${APP_URL}/api/stripe/release`)).status()).toBe(401);
    expect((await request.get(`${APP_URL}/api/stripe/release`, { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.get(`${APP_URL}/api/stripe/release`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status()).toBe(200);
  });

  test("signed-in normal users get 404 from admin pages and admin routes", async ({ browser }) => {
    const user = await createUser();
    const context = await browser.newContext();
    await signIn(context, user);
    const page = await context.newPage();
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(404);
    const api = await context.request.get(`${APP_URL}/api/admin/inspection-file?auction=${crypto.randomUUID()}&file=0`, { maxRedirects: 0 });
    expect(api.status()).toBe(404);
    await context.close();
  });

  test("admins without two-step verification (aal1) can't use the admin panel, admin routes or admin rights in the database", async ({ browser, seed }) => {
    const draft = await createAuction({ seller: await createUser({ role: "seller" }), status: "draft" });

    // Database: is_admin() needs aal2. Signed in with only the first step, the admin
    // sees no other seller's drafts; after the authenticator code, they do.
    const firstStep = await userDb(seed.admin.email);
    expect((await firstStep.from("auctions").select("id").eq("id", draft.id)).data ?? []).toHaveLength(0);
    expect((await firstStep.rpc("is_admin")).data).toBe(false);
    const bothSteps = await userDb(seed.admin.email, { totpSecret: seed.admin.totpSecret });
    expect((await bothSteps.from("auctions").select("id").eq("id", draft.id)).data ?? []).toHaveLength(1);
    expect((await bothSteps.rpc("is_admin")).data).toBe(true);

    // App: the panel sends them to the second step; admin routes answer 404.
    const context = await browser.newContext();
    await signIn(context, seed.admin, { twoFactor: false });
    const page = await context.newPage();
    await page.goto(`/admin/auctions/${draft.id}`);
    await expect(page).toHaveURL(new RegExp(`/two-factor\\?next=${encodeURIComponent(`/admin/auctions/${draft.id}`)}$`));
    const api = await context.request.get(`${APP_URL}/api/admin/inspection-file?auction=${draft.id}&file=0`, { maxRedirects: 0 });
    expect(api.status()).toBe(404);
    await context.close();
  });

});

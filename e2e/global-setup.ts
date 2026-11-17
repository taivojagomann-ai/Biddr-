import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { authenticator } from "otplib";
import { assertLocal, SUPABASE_URL } from "./support/env";
import { createUser, testPhotoUrl, type TestUser } from "./support/factory";
import { userDb } from "./support/supabase";

export interface SeedState {
  admin: TestUser & { totpSecret: string };
  sellerPrivate: TestUser;
  sellerDealer: TestUser;
  bidders: TestUser[];
  incomplete: TestUser;
}

export const STATE_FILE = "e2e/.state/seed.json";

/**
 * Seeds the named users once per run (through the local admin API) and checks
 * that the local stack is up. Tests create their own auctions and extra users.
 */
export default async function globalSetup() {
  assertLocal();
  const health = await fetch(`${SUPABASE_URL}/auth/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error("The local Supabase stack isn't running. Start it with `npx supabase start`.");

  await testPhotoUrl();
  const admin = await createUser({ role: "admin", usernamePrefix: "admin" });
  // Admins have a TOTP factor (two-step sign-in), codes generated with otplib.
  const client = await userDb(admin.email);
  const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "e2e" });
  if (error || !enrolled || enrolled.type !== "totp") throw error ?? new Error("TOTP enrol failed");
  const secret = enrolled.totp.secret;
  const { data: challenge } = await client.auth.mfa.challenge({ factorId: enrolled.id });
  const { error: vErr } = await client.auth.mfa.verify({
    factorId: enrolled.id,
    challengeId: challenge!.id,
    code: authenticator.generate(secret),
  });
  if (vErr) throw vErr;

  const state: SeedState = {
    admin: { ...admin, totpSecret: secret },
    sellerPrivate: await createUser({ role: "seller", usernamePrefix: "private_seller" }),
    sellerDealer: await createUser({ role: "seller", usernamePrefix: "dealer_seller", country: "DE" }),
    bidders: [await createUser({ usernamePrefix: "bidder" }), await createUser({ usernamePrefix: "bidder" }), await createUser({ usernamePrefix: "bidder" })],
    incomplete: await createUser({ complete: false }),
  };
  mkdirSync("e2e/.state", { recursive: true });
  // A lock left behind by an interrupted run (see withStripeMockLock).
  rmSync("e2e/.state/stripe-mock.lock", { recursive: true, force: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

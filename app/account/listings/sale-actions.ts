"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { completeSale, offerToNextBidder, relistCar, type AfterSaleResult } from "@/lib/after-sale";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

const auctionInput = z.object({ auctionId: z.string().uuid() });
const paymentInput = z.object({ paymentId: z.string().uuid() });

async function sellerId(): Promise<string | null> {
  const { data: { user } } = await getServerSupabase().auth.getUser();
  return user?.id ?? null;
}

function done(result: AfterSaleResult): AfterSaleResult {
  revalidatePath("/account/listings");
  revalidatePath("/account/purchases");
  return result;
}

/** The buyer didn't pay: offer the car to the next bidder at their last bid. */
export async function offerToNextBidderAction(input: unknown): Promise<AfterSaleResult> {
  const id = await sellerId();
  if (!id) return { ok: false, error: "Your session has expired. Sign in again." };
  const parsed = auctionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This car no longer exists. Reload the page." };
  return done(await offerToNextBidder(getAdminSupabase(), id, parsed.data.auctionId));
}

/** The buyer didn't pay: a new draft with the same details, reviewed by Biddr's team. */
export async function relistCarAction(input: unknown): Promise<AfterSaleResult> {
  const id = await sellerId();
  if (!id) return { ok: false, error: "Your session has expired. Sign in again." };
  const parsed = auctionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This car no longer exists. Reload the page." };
  return done(await relistCar(getAdminSupabase(), id, parsed.data.auctionId));
}

/** The car was paid for and handed over. */
export async function completeSaleAction(input: unknown): Promise<AfterSaleResult> {
  const id = await sellerId();
  if (!id) return { ok: false, error: "Your session has expired. Sign in again." };
  const parsed = paymentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This sale no longer exists. Reload the page." };
  return done(await completeSale(getAdminSupabase(), id, parsed.data.paymentId));
}

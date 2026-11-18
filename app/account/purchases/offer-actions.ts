"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { acceptOffer, declineOffer, type AfterSaleResult } from "@/lib/after-sale";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

const input = z.object({ offerId: z.string().uuid() });

async function run(raw: unknown, fn: typeof acceptOffer): Promise<AfterSaleResult> {
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This offer no longer exists. Reload the page." };
  const result = await fn(getAdminSupabase(), user.id, parsed.data.offerId);
  revalidatePath("/account/purchases");
  revalidatePath("/account/listings");
  return result;
}

/** Second chance: accept the seller's offer, then pay the premium on the page. */
export async function acceptOfferAction(raw: unknown): Promise<AfterSaleResult> {
  return run(raw, acceptOffer);
}

export async function declineOfferAction(raw: unknown): Promise<AfterSaleResult> {
  return run(raw, declineOffer);
}

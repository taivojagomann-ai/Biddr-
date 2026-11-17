import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Contact details exchanged between the winner and the seller once the buyer's
 * premium is paid (DECISIONS.md point 10 and 11). Read with the service role,
 * on the server only, and only after the caller has been checked to be one of
 * the two parties of a paid buyer_payments row. Never public.
 */
export interface PartyContact {
  fullName: string | null;
  phone: string | null;
  email: string | null;
}

export const CONTACT_NOTE = "Arrange payment for the car and the handover directly with each other.";

export async function partyContact(admin: SupabaseClient, userId: string): Promise<PartyContact> {
  const [{ data: profile }, { data: auth }] = await Promise.all([
    admin.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle<{ full_name: string | null; phone: string | null }>(),
    admin.auth.admin.getUserById(userId),
  ]);
  return { fullName: profile?.full_name ?? null, phone: profile?.phone ?? null, email: auth?.user?.email ?? null };
}

/** The other party's contact for a paid payment the caller is part of; null otherwise. */
export async function contactForPaidPayment(
  admin: SupabaseClient,
  callerId: string,
  payment: { status: string; winner_id: string; seller_id: string },
): Promise<PartyContact | null> {
  if (payment.status !== "paid") return null;
  if (callerId === payment.winner_id) return partyContact(admin, payment.seller_id);
  if (callerId === payment.seller_id) return partyContact(admin, payment.winner_id);
  return null;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export interface AdminContext {
  adminId: string;
  /** Service-role client. Only handed out after the caller is confirmed to be an admin. */
  db: SupabaseClient;
}

/** The signed-in user's id if their profile role is 'admin', otherwise null. Uses the user's own client. */
export async function getCurrentAdminId(): Promise<string | null> {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  return data?.role === "admin" ? user.id : null;
}

/**
 * Call FIRST in every admin server action and route handler. Returns the
 * service-role client only for admins; null for everyone else.
 */
export async function requireAdmin(): Promise<AdminContext | null> {
  const adminId = await getCurrentAdminId();
  if (!adminId) return null;
  return { adminId, db: getAdminSupabase() };
}

/** Appends to the admin_actions audit log. Failures are logged, never thrown, so they can't undo the write. */
export async function logAdminAction(
  ctx: AdminContext,
  auctionId: string | null,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await ctx.db.from("admin_actions").insert({ admin_id: ctx.adminId, auction_id: auctionId, action, details });
  if (error) console.error("admin_actions insert failed", action, error);
}

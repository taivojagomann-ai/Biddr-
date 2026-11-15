import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export interface AdminContext {
  adminId: string;
  /** Service-role client. Only handed out after the caller is confirmed to be an admin. */
  db: SupabaseClient;
}

export type AdminAccess =
  | { status: "none" }
  /** An admin whose session hasn't passed the second factor (aal1). */
  | { status: "needs_2fa"; userId: string }
  | { status: "ok"; adminId: string };

/**
 * Whether the signed-in user may use the admin panel. Admins must have passed
 * two-step verification in this session (assurance level aal2); the database's
 * is_admin() requires the same.
 */
export async function getAdminAccess(): Promise<AdminAccess> {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "none" };
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  if (data?.role !== "admin") return { status: "none" };
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return aal?.currentLevel === "aal2" ? { status: "ok", adminId: user.id } : { status: "needs_2fa", userId: user.id };
}

/** The signed-in admin's id, only after two-step verification; otherwise null. */
export async function getCurrentAdminId(): Promise<string | null> {
  const access = await getAdminAccess();
  return access.status === "ok" ? access.adminId : null;
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

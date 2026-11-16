import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Admins only, after two-step verification. Everyone else gets a plain 404, so
 * the panel's existence isn't revealed. (The middleware sends an admin without
 * the second step to /two-factor with the page they wanted; this is the backstop.)
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await getAdminAccess();
  if (access.status === "needs_2fa") redirect("/two-factor?next=%2Fadmin");
  if (access.status !== "ok") notFound();
  return <div className="pb-16">{children}</div>;
}

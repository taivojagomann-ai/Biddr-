import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentAdminId } from "@/lib/admin";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Admins only. Everyone else gets a plain 404, so the panel's existence isn't revealed. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await getCurrentAdminId())) notFound();
  return <div className="pb-16">{children}</div>;
}

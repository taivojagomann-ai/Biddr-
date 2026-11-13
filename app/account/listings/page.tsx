import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Car, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/format";
import { loginPath } from "@/lib/login";
import { STATUS_LABELS } from "@/lib/sell";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import type { Auction } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My listings" };
export const dynamic = "force-dynamic";

type ListingRow = Pick<Auction, "id" | "title" | "status" | "current_bid" | "bid_count" | "gallery_urls" | "created_at">;

const STATUS_STYLES: Record<Auction["status"], string> = {
  draft: "border-line text-mute",
  upcoming: "border-line text-chalk",
  live: "border-signal text-signal",
  sold: "border-verified text-verified",
  ended: "border-line text-mute",
  reserve_not_met: "border-line text-mute",
  rejected: "border-signal/60 text-signal",
  withdrawn: "border-line text-mute",
};

export default async function MyListingsPage() {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/account/listings"));

  const { data } = await supabase
    .from("auctions")
    .select("id, title, status, current_bid, bid_count, gallery_urls, created_at")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .returns<ListingRow[]>();
  const listings = data ?? [];

  // Rejection reasons live in auction_private, which only admins can read. Read them
  // with the service role, strictly for this seller's own rejected listings.
  const rejectedIds = listings.filter((l) => l.status === "rejected").map((l) => l.id);
  const reasons = new Map<string, string>();
  if (rejectedIds.length) {
    const { data: rows } = await getAdminSupabase()
      .from("auction_private")
      .select("auction_id, rejection_reason, auction:auctions!inner(seller_id)")
      .in("auction_id", rejectedIds)
      .eq("auction.seller_id", user.id)
      .returns<{ auction_id: string; rejection_reason: string | null }[]>();
    for (const r of rows ?? []) if (r.rejection_reason) reasons.set(r.auction_id, r.rejection_reason);
  }

  return (
    <main className="container max-w-3xl py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">My listings</h1>
        <Button asChild size="sm">
          <Link href="/sell">Sell a car</Link>
        </Button>
      </div>

      {listings.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-line p-8 text-center">
          <Car aria-hidden className="mx-auto size-8 text-mute" />
          <p className="mt-3 font-semibold">You haven&apos;t listed a car yet</p>
          <p className="mt-1 text-sm text-mute">Have the registration document and your photos ready before you start.</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-panel">
          {listings.map((l) => {
            const cover = l.gallery_urls?.exterior?.[0];
            const isPublic = l.status !== "draft" && l.status !== "rejected";
            const reason = reasons.get(l.id);
            const body = (
              <>
                <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-md bg-asphalt sm:w-32">
                  {cover ? (
                    <Image src={cover} alt="" fill sizes="128px" className="object-cover" />
                  ) : (
                    <Car aria-hidden className="absolute inset-0 m-auto size-6 text-mute" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className={cn("rounded-sm border px-1.5 py-0.5 text-xs font-semibold", STATUS_STYLES[l.status])}>
                      {STATUS_LABELS[l.status]}
                    </span>
                    {l.current_bid ? (
                      <span className="text-mute">
                        {l.status === "live" ? "Current bid" : "High bid"}{" "}
                        <span className="font-semibold text-chalk">{formatEur(l.current_bid)}</span>
                      </span>
                    ) : null}
                  </p>
                  {l.status === "rejected" ? (
                    <p className="mt-2 rounded-md border border-line bg-asphalt/60 px-2.5 py-2 text-sm">
                      <span className="text-mute">Why: </span>
                      {reason ?? "We couldn't accept this listing. Contact us for details."}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-mute">
                    Submitted {new Date(l.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                {isPublic ? <ChevronRight aria-hidden className="size-5 shrink-0 text-mute" /> : null}
              </>
            );
            return (
              <li key={l.id}>
                {isPublic ? (
                  <Link href={`/auctions/${l.id}`} className="flex items-center gap-4 p-3 hover:bg-asphalt/40">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-4 p-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

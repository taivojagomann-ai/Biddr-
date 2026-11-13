import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/login";
import { NOTIFICATION_COLUMNS, PAGE_SIZE, asNotificationRows } from "@/lib/notifications";
import { getServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { MarkAllReadButton, NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

type SearchParams = { filter?: string; page?: string };

function hrefFor(filter: "all" | "unread", page: number) {
  const params = new URLSearchParams();
  if (filter === "unread") params.set("filter", "unread");
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/account/notifications?${qs}` : "/account/notifications";
}

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/account/notifications"));

  const filter = searchParams.filter === "unread" ? "unread" : "all";
  const page = Math.max(1, Math.floor(Number(searchParams.page) || 1));
  const from = (page - 1) * PAGE_SIZE;

  // RLS limits both queries to the user's own notifications.
  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (filter === "unread") query = query.is("read_at", null);

  const [{ data, count, error }, { count: unreadCount }] = await Promise.all([
    query,
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  const items = asNotificationRows(data);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const unread = unreadCount ?? 0;

  const tab = (key: "all" | "unread", label: string) => (
    <Link
      href={hrefFor(key, 1)}
      aria-current={filter === key ? "page" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center rounded-md px-3 text-sm",
        filter === key ? "bg-chalk font-semibold text-asphalt" : "text-mute hover:text-chalk",
      )}
    >
      {label}
    </Link>
  );

  return (
    <main className="container max-w-2xl py-10 sm:py-14">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">Notifications</h1>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter notifications" className="flex gap-1">
          {tab("all", "All")}
          {tab("unread", `Unread (${unread})`)}
        </nav>
        <MarkAllReadButton disabled={unread === 0} />
      </div>

      <div className="mt-6">
        {error ? (
          <p role="alert" className="text-sm text-signal">
            Notifications couldn&apos;t load. Reload the page.
          </p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-mute">
            {filter === "unread" ? "You're all caught up." : "No notifications yet. We'll let you know about bids, questions and your listings."}
          </p>
        ) : (
          <NotificationList key={`${filter}-${page}-${unread}`} initial={items} initialNow={Date.now()} />
        )}
      </div>

      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Link href={hrefFor(filter, page - 1)} className="inline-flex min-h-11 items-center underline underline-offset-4">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-mute">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={hrefFor(filter, page + 1)} className="inline-flex min-h-11 items-center underline underline-offset-4">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}

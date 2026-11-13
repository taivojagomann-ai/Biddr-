"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { BELL_LIMIT, NOTIFICATION_COLUMNS, asNotificationRows, badgeCount, notificationCopy } from "@/lib/notifications";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NotificationItem, markNotificationsRead } from "./notification-item";

/**
 * Header bell for signed-in users. Shows the unread count (number, not just a dot),
 * opens a panel with the 20 newest notifications, and updates live over Realtime.
 */
export function NotificationBell({ userId, initialNow }: { userId: string; initialNow: number }) {
  const now = useMinuteNow(initialNow);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const headingId = useId();

  const load = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const [list, count] = await Promise.all([
      supabase.from("notifications").select(NOTIFICATION_COLUMNS).order("created_at", { ascending: false }).limit(BELL_LIMIT),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);
    if (list.error) setFailed(true);
    else {
      setFailed(false);
      setItems(asNotificationRows(list.data));
    }
    if (!count.error) setUnread(count.count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: new notifications arrive, and reads from other tabs update the count.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        async (payload: { new: { id?: string } }) => {
          const id = payload.new.id;
          if (!id) return;
          const { data } = await supabase.from("notifications").select(NOTIFICATION_COLUMNS).eq("id", id).maybeSingle();
          const [row] = asNotificationRows(data ? [data] : []);
          if (!row) return;
          setItems((list) => (list.some((x) => x.id === row.id) ? list : [row, ...list].slice(0, BELL_LIMIT)));
          setUnread((n) => n + 1);
          setAnnouncement(`New notification: ${notificationCopy(row).text}`);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  // Focus moves into the panel when it opens.
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  // Escape closes and returns focus to the bell; clicking outside closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const markRead = (id: string) => {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnread((n) => Math.max(0, n - 1));
  };

  async function markAll() {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    const stamp = new Date().toISOString();
    setItems((list) => list.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    setUnread(0);
    // All unread rows, including ones older than the 20 shown.
    const { error } = await getBrowserSupabase().from("notifications").update({ read_at: stamp }).is("read_at", null);
    if (error) {
      await markNotificationsRead(ids);
      void load();
    }
    setAnnouncement("All notifications marked as read.");
  }

  const label = unread ? `Notifications, ${unread} unread` : "Notifications, none unread";

  return (
    <div ref={rootRef} className="sm:relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dc2626] px-1 text-[11px] font-bold leading-none text-white ring-2 ring-asphalt"
          >
            {badgeCount(unread)}
          </span>
        ) : null}
      </Button>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div
        id={panelId}
        role="dialog"
        aria-labelledby={headingId}
        hidden={!open}
        className={cn(
          // Full-width sheet under the header on phones, popover from sm up.
          "fixed inset-x-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-line bg-panel shadow-2xl",
          "sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[70vh] sm:w-96 sm:rounded-lg sm:border",
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-panel px-4 py-3">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-wide text-base font-bold outline-none">
            Notifications
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => void markAll()} disabled={unread === 0}>
            Mark all as read
          </Button>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-mute">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Loading…
          </p>
        ) : failed ? (
          <p role="alert" className="px-4 py-6 text-sm text-signal">
            Notifications couldn&apos;t load. Try again in a moment.
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-mute">No notifications yet. We&apos;ll let you know about bids, questions and your listings.</p>
        ) : (
          <ul className="divide-y divide-line p-1">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationItem n={n} now={now} onRead={markRead} onNavigate={() => setOpen(false)} />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-line p-2">
          <Link
            href="/account/notifications"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center justify-center rounded-md text-sm font-semibold hover:bg-asphalt/60"
          >
            See all
          </Link>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NotificationItem } from "@/components/notifications/notification-item";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/types";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await getBrowserSupabase()
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .is("read_at", null);
          setBusy(false);
          setMessage(error ? "That didn't work. Try again." : "All notifications marked as read.");
          router.refresh();
        }}
      >
        Mark all as read
      </Button>
      <p role="status" className="text-sm text-mute">
        {message}
      </p>
    </div>
  );
}

export function NotificationList({ initial, initialNow }: { initial: NotificationRow[]; initialNow: number }) {
  const now = useMinuteNow(initialNow);
  const [items, setItems] = useState(initial);
  const markRead = (id: string) =>
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-panel p-1">
      {items.map((n) => (
        <li key={n.id}>
          <NotificationItem n={n} now={now} onRead={markRead} />
        </li>
      ))}
    </ul>
  );
}

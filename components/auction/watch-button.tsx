"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { seedWatch, setWatching, useWatch } from "@/lib/client/watch-store";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Watch / Watching toggle (aria-pressed). Optimistic, rolls back on error.
 * Signed-out users are sent to sign in and brought back to this page.
 */
export function WatchButton({
  auctionId,
  title,
  userId,
  initialWatching,
  initialCount,
  size = "sm",
  className,
}: {
  auctionId: string;
  /** Car title, for a unique accessible name where several buttons share a page. */
  title?: string;
  userId: string | null;
  initialWatching: boolean;
  initialCount: number;
  size?: ButtonProps["size"];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // Seed during the first render so every button for this car starts the same.
  useState(() => seedWatch(auctionId, initialWatching, initialCount));
  const entry = useWatch(auctionId, { watching: initialWatching, count: initialCount });
  const watching = entry.watching ?? initialWatching;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (!userId) {
      const qs = search.toString();
      router.push(`/login?next=${encodeURIComponent(`${pathname}${qs ? `?${qs}` : ""}`)}`);
      return;
    }
    const next = !watching;
    setBusy(true);
    setError("");
    setWatching(auctionId, next); // optimistic
    const supabase = getBrowserSupabase();
    const { error: dbError } = next
      ? await supabase.from("watchlist").insert({ user_id: userId, auction_id: auctionId })
      : await supabase.from("watchlist").delete().eq("user_id", userId).eq("auction_id", auctionId);
    // A duplicate means it was already on the watchlist (another tab): keep "Watching".
    if (dbError && dbError.code !== "23505") {
      setWatching(auctionId, !next); // roll back
      setError(next ? "Couldn't add this car to your watchlist. Try again." : "Couldn't remove this car. Try again.");
    }
    setBusy(false);
  }

  return (
    <span className={cn("inline-flex flex-col items-start", className)}>
      <Button
        type="button"
        variant={watching ? "secondary" : "outline"}
        size={size}
        aria-pressed={watching}
        disabled={busy}
        onClick={() => void toggle()}
      >
        <Eye aria-hidden />
        {watching ? "Watching" : "Watch"}
        {title ? <span className="sr-only"> {title}</span> : null}
      </Button>
      {error ? (
        <span role="alert" className="mt-1 text-xs text-signal">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** "<n> watching", hidden when nobody is. Updates with the shared store. */
export function WatchCount({ auctionId, initialCount, className }: { auctionId: string; initialCount: number; className?: string }) {
  useState(() => seedWatch(auctionId, null, initialCount));
  const { count } = useWatch(auctionId, { watching: null, count: initialCount });
  if (count <= 0) return null;
  return <span className={cn("text-sm text-mute tabular", className)}>{count.toLocaleString("en-IE")} watching</span>;
}

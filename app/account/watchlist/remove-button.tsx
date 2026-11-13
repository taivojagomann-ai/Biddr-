"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setWatching } from "@/lib/client/watch-store";
import { getBrowserSupabase } from "@/lib/supabase/client";

export function RemoveFromWatchlist({ auctionId, userId, title }: { auctionId: string; userId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const { error: dbError } = await getBrowserSupabase()
            .from("watchlist")
            .delete()
            .eq("user_id", userId)
            .eq("auction_id", auctionId);
          setBusy(false);
          if (dbError) {
            setError("Couldn't remove it. Try again.");
            return;
          }
          setWatching(auctionId, false);
          router.refresh();
        }}
      >
        <X aria-hidden />
        Remove<span className="sr-only"> {title} from your watchlist</span>
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-signal">
          {error}
        </span>
      ) : null}
    </span>
  );
}

"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { RelativeTime } from "@/components/relative-time";
import { cn } from "@/lib/utils";
import { COMMENT_COLUMNS, type CommentRow } from "@/lib/types";

interface CommentsProps {
  auctionId: string;
  sellerId: string;
  comments: CommentRow[];
  onPosted: (c: CommentRow) => void;
  currentUserId: string | null;
  canComment: boolean;
  initialNow: number;
}

export function Comments({ auctionId, sellerId, comments, onPosted, currentUserId, canComment, initialNow }: CommentsProps) {
  const now = useMinuteNow(initialNow);
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);

  const { roots, replies } = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    const replies = new Map<string, CommentRow[]>();
    for (const c of comments) {
      if (!c.parent_id) continue;
      replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
    }
    return { roots: [...roots].reverse(), replies };
  }, [comments]);

  return (
    <section aria-labelledby="comments-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 id="comments-heading" className="text-lg font-bold">Questions and comments</h2>
        <span className="text-sm text-mute tabular">{comments.length}</span>
      </div>

      {currentUserId && canComment ? (
        <CommentForm auctionId={auctionId} replyTo={null} onPosted={onPosted} />
      ) : currentUserId ? (
        <p className="rounded-lg border border-line bg-panel p-4 text-sm text-mute">
          <Link
            href={`/account/setup?next=${encodeURIComponent(`/auctions/${auctionId}`)}`}
            className="font-semibold text-chalk underline underline-offset-4"
          >
            Finish your profile to comment
          </Link>
          . Comments show your username and country.
        </p>
      ) : (
        <p className="rounded-lg border border-line bg-panel p-4 text-sm text-mute">
          <Link href={`/login?next=/auctions/${auctionId}`} className="font-semibold text-chalk underline underline-offset-4">Sign in</Link>{" "}
          to ask the seller a question.
        </p>
      )}

      {roots.length === 0 ? (
        <p className="text-sm text-mute">No questions yet. Ask about service history, tyres or anything the photos don&apos;t show.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {roots.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-panel p-4">
              <CommentBody comment={c} sellerId={sellerId} now={now} />
              {currentUserId && canComment && (
                <button type="button" onClick={() => setReplyTo(replyTo?.id === c.id ? null : c)}
                  aria-expanded={replyTo?.id === c.id}
                  className="-ml-2 mt-1 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-mute hover:text-chalk">
                  {replyTo?.id === c.id ? "Cancel reply" : "Reply"}
                  <span className="sr-only"> to {c.author?.username ?? "this comment"}</span>
                </button>
              )}
              {(replies.get(c.id) ?? []).length > 0 && (
                <ul className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-4">
                  {(replies.get(c.id) ?? []).map((r) => (
                    <li key={r.id}><CommentBody comment={r} sellerId={sellerId} now={now} /></li>
                  ))}
                </ul>
              )}
              {replyTo?.id === c.id && (
                <div className="mt-3">
                  <CommentForm auctionId={auctionId} replyTo={c} onPosted={(nc) => { onPosted(nc); setReplyTo(null); }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentBody({ comment, sellerId, now }: { comment: CommentRow; sellerId: string; now: number }) {
  const isSeller = comment.user_id === sellerId;
  const isStaff = comment.author?.role === "admin";
  return (
    <div className={cn(comment.is_seller_reply && "rounded-md bg-signal/5 p-3 -m-1")}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{comment.author?.username ?? "Member"}</span>
        {isSeller && <span className="rounded-sm bg-signal px-1.5 py-0.5 text-[11px] font-bold text-asphalt">Seller</span>}
        {isStaff && !isSeller && <span className="rounded-sm bg-chalk px-1.5 py-0.5 text-[11px] font-bold text-asphalt">Biddr team</span>}
        <RelativeTime iso={comment.created_at} now={now} className="text-xs text-mute" />
      </div>
      <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed">{comment.content}</p>
    </div>
  );
}

function CommentForm({ auctionId, replyTo, onPosted }: { auctionId: string; replyTo: CommentRow | null; onPosted: (c: CommentRow) => void }) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const id = replyTo ? `reply-${replyTo.id}` : "new-comment";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setPosted(false);
    const { data, error } = await getBrowserSupabase()
      .from("comments")
      .insert({ auction_id: auctionId, parent_id: replyTo?.id ?? null, content: text })
      .select(COMMENT_COLUMNS)
      .single<CommentRow>();
    setBusy(false);
    if (error || !data) {
      setError(
        error?.message === "PROFILE_INCOMPLETE"
          ? "Finish your profile to comment: add a username and country."
          : "Your comment wasn't posted. Check your connection and try again.",
      );
      return;
    }
    setContent("");
    setPosted(true);
    onPosted(data);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {replyTo ? `Reply to ${replyTo.author?.username ?? "this comment"}` : "Ask the seller a question"}
      </label>
      <Textarea id={id} value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} rows={replyTo ? 2 : 3}
        placeholder={replyTo ? undefined : "e.g. service history, tyres, anything the photos don't show"}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-0 resize-y p-3" autoFocus={Boolean(replyTo)} />
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-signal">{error}</p>}
      <p role="status" className="sr-only">{posted ? (replyTo ? "Your reply was posted." : "Your question was posted.") : ""}</p>
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !content.trim()}>
          {busy ? "Posting…" : replyTo ? "Post reply" : "Post question"}
        </Button>
      </div>
    </form>
  );
}

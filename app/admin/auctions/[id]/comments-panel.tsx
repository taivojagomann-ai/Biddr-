"use client";
import { RelativeTime } from "@/components/relative-time";
import type { CommentRow } from "@/lib/types";
import { deleteComment } from "../../actions";
import { ActionMessage, useAdminAction } from "./action-feedback";
import { ConfirmButton } from "./confirm-button";

export function CommentsPanel({ auctionId, comments, now }: { auctionId: string; comments: CommentRow[]; now: number }) {
  const { run, pending, result } = useAdminAction();
  const replyCount = (id: string) => comments.filter((c) => c.parent_id === id).length;

  if (comments.length === 0) return <p className="text-sm text-mute">No comments.</p>;
  return (
    <div className="space-y-3">
      <ActionMessage result={result} />
      <ul className="divide-y divide-line">
        {comments.map((c) => {
          const replies = replyCount(c.id);
          return (
            <li key={c.id} className={c.parent_id ? "py-3 pl-6" : "py-3"}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">{c.author?.username ?? "Member"}</span>
                    {c.is_seller_reply ? <span className="ml-2 text-xs text-signal">Seller or team</span> : null}
                    <span className="ml-2 text-xs text-mute">
                      <RelativeTime iso={c.created_at} now={now} />
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm">{c.content}</p>
                </div>
                <ConfirmButton
                  label="Delete"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  title="Delete this comment?"
                  description={
                    <>
                      <p>It&apos;s removed from the public page for everyone. You can&apos;t undo this.</p>
                      {replies > 0 ? (
                        <p className="text-chalk">
                          Its {replies} {replies === 1 ? "reply is" : "replies are"} deleted too.
                        </p>
                      ) : null}
                    </>
                  }
                  confirmLabel="Delete comment"
                  destructive
                  onConfirm={async () => (await run(deleteComment, { auctionId, commentId: c.id })).ok}
                >
                  {result && !result.ok ? <ActionMessage result={result} /> : null}
                </ConfirmButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

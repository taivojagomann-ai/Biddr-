// Messages between the buyer and the seller after a sale (migration 0026, DECISIONS.md
// point 13). Shared by the browser and the server; writes go through send_message().

export const MESSAGE_MAX = 2000;
/** Read-only this long after "Sale completed", or after the premium was paid if never completed. */
export const READ_ONLY_DAYS_AFTER_COMPLETED = 30;
export const READ_ONLY_DAYS_AFTER_SALE = 60;

export type SenderRole = "buyer" | "seller" | "support";

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_role: SenderRole;
  body: string;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  auction_id: string;
  buyer_payment_id: string;
  buyer_id: string;
  seller_id: string;
  last_message_at: string | null;
  buyer_last_read_at: string | null;
  seller_last_read_at: string | null;
  created_at: string;
}

export const MESSAGE_COLUMNS = "id, conversation_id, sender_id, sender_role, body, created_at";

/** Shown at the top of every conversation. */
export const SAFETY_NOTE =
  "Biddr never asks you to pay through messages. Pay the seller only after you've seen the car and its documents.";

const ERRORS: Record<string, string> = {
  CONVERSATION_NOT_FOUND: "This conversation isn't available.",
  CONVERSATION_CLOSED: "This sale is closed, so no new messages can be sent.",
  CONVERSATION_READ_ONLY: "This conversation is now read-only.",
  MESSAGE_EMPTY: "Write a message first.",
  MESSAGE_TOO_LONG: `Keep the message under ${MESSAGE_MAX.toLocaleString("en-GB")} characters.`,
  MESSAGE_RATE_LIMIT: "You've sent a lot of messages in a short time. Wait a few minutes, then try again.",
  NOT_AUTHENTICATED: "Your session has expired. Sign in again.",
};

export function messageError(code: string | undefined): string {
  return (code && ERRORS[code]) || "Your message wasn't sent. Check your connection and try again.";
}

/** The name shown for a message's sender, from the reader's point of view. */
export function senderLabel(role: SenderRole, viewerRole: "buyer" | "seller" | "admin"): string {
  if (role === "support") return "Biddr support";
  if (role === viewerRole) return "You";
  return role === "buyer" ? "Buyer" : "Seller";
}

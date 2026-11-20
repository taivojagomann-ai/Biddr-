// Conversations between a buyer and a seller (migrations 0026 and 0029, DECISIONS.md
// point 14): "Contact seller" before bidding, carrying on after the sale. Shared by the
// browser and the server; writes go through the database functions (send_message,
// start_conversation, propose_viewing, respond_viewing, share_phone, report_conversation).

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
  /** Contact details were replaced by "[contact details hidden]" (before the sale is paid). */
  masked: boolean;
  created_at: string;
}

export type Topic = "viewing" | "inspection" | "question" | "sale";

export interface ConversationRow {
  id: string;
  auction_id: string;
  buyer_payment_id: string | null;
  topic: Topic;
  status: "open" | "closed";
  /** When the buyer's premium was paid and this became the after-sale conversation. */
  sale_confirmed_at: string | null;
  buyer_id: string;
  seller_id: string;
  last_message_at: string | null;
  buyer_last_read_at: string | null;
  seller_last_read_at: string | null;
  created_at: string;
}

export const MESSAGE_COLUMNS = "id, conversation_id, sender_id, sender_role, body, masked, created_at";

/** The topics a buyer chooses from when contacting a seller, as offered on the form. */
export const CONTACT_TOPICS: { value: Exclude<Topic, "sale">; label: string; hint: string }[] = [
  { value: "viewing", label: "Request a viewing or test drive", hint: "Suggest up to 3 times that suit you." },
  { value: "inspection", label: "Arrange a pre-purchase inspection", hint: "At a workshop of your choice, at your cost. Suggest up to 3 times." },
  { value: "question", label: "Private question", hint: "Questions everyone would find useful are better asked in public under the listing." },
];

export const TOPIC_LABELS: Record<Topic, string> = {
  viewing: "Viewing or test drive",
  inspection: "Pre-purchase inspection",
  question: "Private question",
  sale: "Sale",
};

/** Shown in every conversation. */
export const INFO_LINE =
  "Viewings, test drives and inspections are arranged between you and the seller, at the buyer's cost. Bids are binding, so check the car before you bid. Biddr never asks you to pay for a car through a link.";

/** Before the buyer's premium is paid, contact details in messages are hidden. */
export const MASKING_NOTE = "Phone numbers, email addresses and links are hidden until the buyer's premium is paid.";
export const MASK_TOKEN = "[contact details hidden]";

/** Shown in the thread when the auction is won and the premium paid. */
export const SALE_DIVIDER = "Sale confirmed: contact details are now shared";

export const VIEWING_MAX_SLOTS = 3;

export interface ViewingRequestRow {
  id: string;
  conversation_id: string;
  proposed_slots: string[];
  confirmed_slot: string | null;
  status: "proposed" | "confirmed" | "declined" | "cancelled";
  created_by: string;
  responded_by: string | null;
  created_at: string;
  updated_at: string;
}
export const VIEWING_COLUMNS = "id, conversation_id, proposed_slots, confirmed_slot, status, created_by, responded_by, created_at, updated_at";

export interface SharedPhone {
  user_id: string;
  phone: string;
  shared_at: string;
}

/** conversation_state(): which phase the conversation is in and whether it takes messages. */
export interface ConversationState {
  phase: "pre_sale" | "sale";
  writable: boolean;
  reason: string | null;
  read_only_at?: string | null;
}

/** Why a conversation doesn't take new messages, as shown under it. */
export function readOnlyText(reason: string | null | undefined): string {
  switch (reason) {
    case "AUCTION_ENDED":
      return "This auction has ended.";
    case "CONVERSATION_CLOSED_BY_BIDDR":
      return "Biddr closed this conversation.";
    case "CONVERSATION_CLOSED":
      return "This sale is closed, so no new messages can be sent.";
    default:
      return "This conversation is read-only now. You can still read it here.";
  }
}

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
  CONVERSATION_CLOSED_BY_BIDDR: "Biddr closed this conversation.",
  AUCTION_ENDED: "This auction has ended.",
  AUCTION_NOT_OPEN: "You can contact the seller while the auction is coming up or live.",
  DEMO_AUCTION: "This is a demo listing.",
  OWN_AUCTION: "This is your own car.",
  PROFILE_INCOMPLETE: "Finish your profile first.",
  TERMS_NOT_ACCEPTED: "Accept the bidding terms first.",
  BIDDING_BLOCKED: "Your account can't bid or contact sellers right now. Contact Biddr for details.",
  MESSAGING_BLOCKED: "Your account can't send messages right now. Contact Biddr for details.",
  TOPIC_REQUIRED: "Choose what your message is about.",
  CONVERSATION_RATE_LIMIT: "You've contacted 10 sellers today. Try again tomorrow.",
  VIEWING_SLOTS: "Suggest 1 to 3 different times.",
  VIEWING_SLOT_TIME: "Choose times in the next 90 days.",
  VIEWING_RATE_LIMIT: "You've proposed a lot of times today. Try again tomorrow.",
  VIEWING_NOT_PENDING: "This request has already been answered.",
  VIEWING_NOT_FOUND: "This request isn't available.",
  VIEWING_NOT_CONFIRMED: "You can share your phone number once a viewing is confirmed.",
  PHONE_MISSING: "Add your phone number to your profile first.",
  REPORT_REASON_SHORT: "Describe the problem in at least 10 characters.",
  REPORT_REASON_LONG: "Keep it under 1,000 characters.",
  REPORT_ALREADY_OPEN: "You've already reported this conversation. Biddr's team will look at it.",
  REPORT_RATE_LIMIT: "You've sent several reports today. Try again tomorrow.",
};

export function messageError(code: string | undefined, fallback = "Your message wasn't sent. Check your connection and try again."): string {
  return (code && ERRORS[code]) || fallback;
}

/** The name shown for a message's sender, from the reader's point of view. */
export function senderLabel(role: SenderRole, viewerRole: "buyer" | "seller" | "admin"): string {
  if (role === "support") return "Biddr support";
  if (role === viewerRole) return "You";
  return role === "buyer" ? "Buyer" : "Seller";
}

/** A conversation has news for this party: activity after they last read it. */
export function isUnread(lastMessageAt: string | null, lastReadAt: string | null): boolean {
  return Boolean(lastMessageAt && (!lastReadAt || Date.parse(lastMessageAt) > Date.parse(lastReadAt)));
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { partyContact, CONTACT_NOTE } from "@/lib/contacts";
import { formatEur } from "@/lib/format";
import { ensureInvoice, invoiceFileName } from "@/lib/invoice/issue";
import { renderInvoicePdf } from "@/lib/invoice/pdf";
import { SELLER_PAYMENT_DAYS } from "@/lib/settlement-constants";
import type { BuyerPaymentRow } from "@/lib/settlement";
import { siteUrl } from "@/lib/site";
import { formatDateTime, formatDate } from "@/lib/zoned-time";
import { renderEmail, type EmailContent } from "./layout";

/** Time zones for dates in emails: the recipient's country (DECISIONS.md point 7: the reader's own zone). */
const COUNTRY_TZ: Record<string, string> = {
  AT: "Europe/Vienna", BE: "Europe/Brussels", BG: "Europe/Sofia", HR: "Europe/Zagreb", CY: "Asia/Nicosia",
  CZ: "Europe/Prague", DK: "Europe/Copenhagen", EE: "Europe/Tallinn", FI: "Europe/Helsinki", FR: "Europe/Paris",
  DE: "Europe/Berlin", GR: "Europe/Athens", HU: "Europe/Budapest", IE: "Europe/Dublin", IT: "Europe/Rome",
  LV: "Europe/Riga", LT: "Europe/Vilnius", LU: "Europe/Luxembourg", MT: "Europe/Malta", NL: "Europe/Amsterdam",
  PL: "Europe/Warsaw", PT: "Europe/Lisbon", RO: "Europe/Bucharest", SK: "Europe/Bratislava", SI: "Europe/Ljubljana",
  ES: "Europe/Madrid", SE: "Europe/Stockholm",
};
export const timeZoneFor = (country: string | null | undefined) => COUNTRY_TZ[(country ?? "").toUpperCase()] ?? "Europe/Tallinn";

/** Notification types that are emailed (same rule as notification_is_emailed() in 0028). */
export function isEmailed(type: string, data: Record<string, unknown>): boolean {
  switch (type) {
    case "auction_won":
    case "premium_due":
    case "premium_reminder":
    case "premium_paid":
    case "premium_unpaid":
    case "second_chance_offer":
      return true;
    case "auction_ended":
      return data.status === "sold";
    case "buyer_did_not_pay":
      return data.role === "seller";
    default:
      return false;
  }
}
export const EMAIL_TYPES = ["auction_won", "auction_ended", "premium_due", "premium_reminder", "premium_paid", "premium_unpaid", "buyer_did_not_pay", "second_chance_offer"];

export interface EmailNotification {
  id: string;
  user_id: string;
  type: string;
  auction_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The email for one notification, or null if this notification isn't emailed. */
export async function buildEmail(admin: SupabaseClient, n: EmailNotification, country: string | null): Promise<BuiltEmail | null> {
  if (!isEmailed(n.type, n.data)) return null;
  const tz = timeZoneFor(country);
  const when = (iso: string) => formatDateTime(iso, tz);
  const day = (iso: string) => formatDate(iso, tz);
  const base = siteUrl();
  const { data: auction } = n.auction_id
    ? await admin.from("auctions").select("title, current_bid").eq("id", n.auction_id).maybeSingle<{ title: string; current_bid: number | null }>()
    : { data: null };
  const car = auction?.title ?? "your car";
  const purchases = { label: "Open My purchases", href: `${base}/account/purchases` };
  const listings = { label: "Open My listings", href: `${base}/account/listings` };

  // The sale's payment row, for premium amounts, dates and contacts.
  const payment = async (role: "winner" | "seller") => {
    if (!n.auction_id) return null;
    const { data } = await admin
      .from("buyer_payments")
      .select("*")
      .eq("auction_id", n.auction_id)
      .eq(role === "winner" ? "winner_id" : "seller_id", n.user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<BuyerPaymentRow[]>();
    return data?.[0] ?? null;
  };

  let content: EmailContent;
  let attachments: BuiltEmail["attachments"];
  switch (n.type) {
    case "auction_won": {
      const bid = num(n.data.final_bid) ?? auction?.current_bid ?? null;
      const p = await payment("winner");
      content = {
        subject: `You won ${car}`,
        preview: "Next: the buyer's premium is charged to your card.",
        heading: `You won ${car}${bid ? ` for ${formatEur(bid)}` : ""}`,
        paragraphs: [
          `Biddr is now charging the buyer's premium${p ? ` of ${formatEur(p.premium_amount)}` : ""} to your card: up to €500 comes from your card hold, and any rest from the same card.`,
          "Once it's paid, you'll get the seller's contact details to arrange the payment for the car and the handover. You pay the car itself directly to the seller.",
        ],
        button: purchases,
      };
      break;
    }
    case "auction_ended": {
      const bid = num(n.data.final_bid) ?? auction?.current_bid ?? null;
      content = {
        subject: `Your ${car} sold${bid ? ` for ${formatEur(bid)}` : ""}`,
        preview: "Waiting for the buyer to pay the buyer's premium.",
        heading: `Your ${car} sold${bid ? ` for ${formatEur(bid)}` : ""}`,
        paragraphs: [
          "Now the buyer pays Biddr's buyer's premium. Once it's paid, you'll get their contact details to arrange the payment for the car and the handover.",
        ],
        button: listings,
      };
      break;
    }
    case "premium_due":
    case "premium_reminder": {
      const due = str(n.data.due_at);
      const declined = n.data.reason === "failed";
      const reminder = n.type === "premium_reminder";
      content = {
        subject: reminder ? `Reminder: pay the buyer's premium for ${car}` : declined ? `Your card was declined for ${car}` : `Please confirm the payment for ${car}`,
        preview: due ? `Please pay by ${when(due)}.` : "Please complete the payment.",
        heading: reminder ? "Your payment is still needed" : declined ? "Your card was declined" : "Your bank needs you to confirm the payment",
        paragraphs: [
          `Please complete the payment of the buyer's premium for ${car} on My purchases${due ? ` by ${when(due)}` : ""}.`,
          "If it isn't paid by then, the sale is cancelled, what was taken from your card hold isn't refunded, and your bidding is blocked.",
        ],
        button: { label: "Complete payment", href: `${base}/account/purchases` },
      };
      break;
    }
    case "premium_paid": {
      const seller = n.data.role === "seller";
      const p = await payment(seller ? "seller" : "winner");
      if (!p) return null;
      const other = await partyContact(admin, seller ? p.winner_id : p.seller_id);
      const { data: conv } = await admin.from("conversations").select("id").eq("buyer_payment_id", p.id).maybeSingle<{ id: string }>();
      const payBy = p.paid_at ? day(new Date(Date.parse(p.paid_at) + SELLER_PAYMENT_DAYS * 86_400_000).toISOString()) : null;
      const details = [
        { label: seller ? "Buyer" : "Seller", value: other.fullName ?? "Not given" },
        { label: "Phone", value: other.phone ?? "Not given" },
        { label: "Email", value: other.email ?? "Not given" },
      ];
      const message = conv ? { label: seller ? "Message the buyer" : "Message the seller", href: `${base}/account/messages/${conv.id}` } : seller ? listings : purchases;
      if (seller) {
        content = {
          subject: `The buyer of ${car} paid: their contact details`,
          preview: "Arrange the payment for the car and the handover.",
          heading: "The buyer paid the buyer's premium",
          paragraphs: [
            `Here are the buyer's contact details for ${car}. ${CONTACT_NOTE}`,
            `${payBy ? `They have until ${payBy} to pay you for the car. ` : ""}Mark the sale completed on My listings once you've received the payment and handed over the car.`,
          ],
          details,
          button: message,
        };
      } else {
        content = {
          subject: `Buyer's premium paid: ${car}`,
          preview: "Your invoice and the seller's contact details.",
          heading: "Thanks, the buyer's premium is paid",
          paragraphs: [
            `The buyer's premium of ${formatEur(p.premium_amount)} for ${car} is paid. Your invoice is attached.`,
            `Here are the seller's contact details. ${CONTACT_NOTE}${payBy ? ` Please pay the seller for the car by ${payBy}.` : ""}`,
          ],
          details,
          button: message,
        };
        // The invoice for the whole premium, as a PDF.
        const invoice = await ensureInvoice(admin, p.id).catch(() => null);
        if (invoice) {
          const pdf = await renderInvoicePdf(invoice, { testMode: !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") });
          attachments = [{ filename: invoiceFileName(invoice), content: Buffer.from(pdf), contentType: "application/pdf" }];
        }
      }
      break;
    }
    case "premium_unpaid": {
      const kept = num(n.data.kept) ?? 0;
      content = {
        subject: `Your purchase of ${car} was cancelled`,
        preview: "The buyer's premium wasn't paid in time.",
        heading: "The sale was cancelled",
        paragraphs: [
          `The buyer's premium for ${car} wasn't paid in time, so the sale is cancelled${kept > 0 ? ` and the ${formatEur(kept)} taken from your card hold isn't refunded` : ""}.`,
          "Your bidding is blocked. Contact Biddr if you think this is a mistake.",
        ],
        button: purchases,
      };
      break;
    }
    case "buyer_did_not_pay":
      content = {
        subject: `The buyer of ${car} didn't pay`,
        preview: "Offer the car to the next bidder, or relist it.",
        heading: "The buyer didn't pay",
        paragraphs: [
          `The buyer's premium for ${car} wasn't paid in time, so the sale is cancelled and the buyer can no longer bid.`,
          "On My listings you can offer the car to the next bidder at their highest bid, or relist it.",
        ],
        button: listings,
      };
      break;
    case "second_chance_offer": {
      const amount = num(n.data.amount);
      const until = str(n.data.expires_at);
      const { data: offer } = n.auction_id
        ? await admin
            .from("second_chance_offers")
            .select("premium_amount")
            .eq("auction_id", n.auction_id)
            .eq("bidder_id", n.user_id)
            .maybeSingle<{ premium_amount: number }>()
        : { data: null };
      content = {
        subject: `Second chance: buy ${car}${amount ? ` for ${formatEur(amount)}` : ""}`,
        preview: until ? `Answer by ${when(until)}.` : "The seller offers you the car.",
        heading: "The car can be yours",
        paragraphs: [
          `The winner didn't pay, so the seller offers you ${car} at your highest bid${amount ? ` of ${formatEur(amount)}` : ""}.`,
          `${offer ? `The buyer's premium is ${formatEur(offer.premium_amount)}, paid to Biddr when you accept. ` : ""}Accept and pay on My purchases${until ? ` by ${when(until)}` : ""}. Accepting is binding.`,
        ],
        button: { label: "See the offer", href: `${base}/account/purchases` },
      };
      break;
    }
    default:
      return null;
  }
  return { ...renderEmail(content), attachments };
}

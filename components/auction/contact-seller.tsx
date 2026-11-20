import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Where "Contact seller" leads: the contact page, or the buyer's existing conversation. */
export interface ContactLink {
  href: string;
  /** The buyer already has a conversation about this car. */
  existing: boolean;
}

/** Shown while the auction is upcoming or live, never to the seller or on demo listings. */
export function contactAvailable(a: { status: string; is_demo: boolean; seller_id: string }, userId: string | null): boolean {
  return (a.status === "upcoming" || a.status === "live") && !a.is_demo && a.seller_id !== userId;
}

export function contactLabel(link: ContactLink): string {
  return link.existing ? "Open your conversation" : "Contact seller";
}

/** The outline button in the seller card (signed-out and incomplete profiles are guided on the contact page). */
export function ContactSellerButton({ link, className }: { link: ContactLink; className?: string }) {
  return (
    <Button asChild variant="outline" className={cn("min-h-11 w-full sm:w-auto", className)}>
      <Link href={link.href}>
        <MessageCircle aria-hidden />
        {contactLabel(link)}
      </Link>
    </Button>
  );
}

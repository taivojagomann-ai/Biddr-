import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AuctionNotFound() {
  return (
    <main className="container flex flex-col items-start gap-4 py-20">
      <h1 className="font-wide text-3xl font-extrabold">This auction isn&apos;t listed</h1>
      <p className="max-w-md text-mute">It may have been withdrawn by the seller or the link is incomplete.</p>
      <Button asChild><Link href="/">See live auctions</Link></Button>
    </main>
  );
}

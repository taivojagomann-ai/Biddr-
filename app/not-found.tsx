import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="container flex flex-col items-start gap-4 py-20">
      <h1 className="font-wide text-3xl font-extrabold">We can&apos;t find that page</h1>
      <p className="max-w-md text-mute">The link may be incomplete, or the page has moved.</p>
      <Button asChild>
        <Link href="/">See live auctions</Link>
      </Button>
    </main>
  );
}

import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getServerSupabase } from "@/lib/supabase/server";

export async function SiteHeader() {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  let username: string | null = null;
  let isAdmin = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("username, role")
      .eq("id", user.id)
      .maybeSingle<{ username: string | null; role: string }>();
    username = data?.username ?? null;
    isAdmin = data?.role === "admin";
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-asphalt/90 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="font-wide text-lg font-extrabold tracking-tight">
          Biddr<span className="text-signal">.</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="hidden rounded-md px-3 py-2 text-mute hover:text-chalk sm:inline-flex">
            Auctions
          </Link>
          <Link href="/sell" className="whitespace-nowrap rounded-md px-2 py-2 text-mute hover:text-chalk sm:px-3">
            Sell a car
          </Link>
          {user ? (
            <>
              {isAdmin ? (
                <Link href="/admin" className="rounded-md px-2 py-2 font-semibold text-signal hover:text-chalk sm:px-3">
                  Admin
                </Link>
              ) : null}
              {username ? (
                <Link href="/account/listings" className="rounded-md px-2 py-2 text-mute hover:text-chalk sm:px-3">
                  <span className="sm:hidden">Listings</span>
                  <span className="hidden sm:inline">My listings</span>
                </Link>
              ) : null}
              <Link
                href="/account/setup"
                className="max-w-[7rem] truncate sm:max-w-[10rem] rounded-md border border-line px-3 py-2 hover:border-mute"
              >
                {username ?? "Finish profile"}
              </Link>
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
                  <LogOut aria-hidden="true" />
                </Button>
              </form>
            </>
          ) : (
            <Link href="/login" className="rounded-md border border-line px-3 py-2 hover:border-mute">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

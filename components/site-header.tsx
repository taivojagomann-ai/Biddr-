import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { MobileMenu, type MenuLink } from "@/components/mobile-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getServerSupabase } from "@/lib/supabase/server";

const navLink =
  "inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-3 text-mute hover:text-chalk [@media(pointer:coarse)]:min-h-11";

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

  const now = Date.now();
  const menuLinks: MenuLink[] = [
    { label: "Auctions", href: "/" },
    { label: "How it works", href: "/how-it-works" },
    { label: "Sell a car", href: "/sell" },
    ...(user ? [{ label: username ? `Profile (${username})` : "Finish profile", href: "/account/setup" }] : []),
    ...(user ? [{ label: "Selling", href: "/account/listings" }] : []),
    ...(user ? [{ label: "Watchlist", href: "/account/watchlist" }] : []),
    ...(user ? [{ label: "Notifications", href: "/account/notifications" }] : []),
    ...(isAdmin ? [{ label: "Admin", href: "/admin" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-asphalt/90 backdrop-blur">
      <div className="container relative flex h-14 items-center justify-between gap-2">
        <Link href="/" className="inline-flex min-h-10 items-center font-wide text-lg font-extrabold tracking-tight">
          Biddr<span className="text-signal">.</span>
          <span className="sr-only">, home</span>
        </Link>

        {/* Small screens: sign in stays visible, everything else is in the menu. */}
        <div className="flex items-center gap-2 sm:hidden">
          {!user ? (
            <Link href="/login" className="inline-flex min-h-10 items-center rounded-md border border-field px-3 text-sm hover:border-chalk">
              Sign in
            </Link>
          ) : (
            <NotificationBell userId={user.id} initialNow={now} />
          )}
          <MobileMenu links={menuLinks} signedIn={Boolean(user)} />
        </div>

        <nav aria-label="Main" className="hidden items-center gap-1 text-sm sm:flex">
          <Link href="/" className={navLink}>
            Auctions
          </Link>
          <Link href="/how-it-works" className={`${navLink} hidden md:inline-flex`}>
            How it works
          </Link>
          <Link href="/sell" className={navLink}>
            Sell a car
          </Link>
          {user ? (
            <>
              {isAdmin ? (
                <Link href="/admin" className={`${navLink} font-semibold text-signal`}>
                  Admin
                </Link>
              ) : null}
              <NotificationBell userId={user.id} initialNow={now} />
              <AccountMenu label={username ?? "Finish profile"} />
            </>
          ) : (
            <Link href="/login" className="inline-flex min-h-10 items-center rounded-md border border-field px-3 hover:border-chalk">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

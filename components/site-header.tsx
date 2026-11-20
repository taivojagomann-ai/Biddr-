import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { MobileMenu, type MenuLink } from "@/components/mobile-menu";
import { NavLink } from "@/components/nav-link";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SELL_BUTTON } from "@/lib/nav";
import { getServerSupabase } from "@/lib/supabase/server";
import { totalUnanswered, unansweredQuestions } from "@/lib/unanswered-questions";
import { unreadConversations } from "@/lib/unread-conversations";

const navLink =
  "inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-3 text-mute hover:text-chalk aria-[current=page]:font-semibold aria-[current=page]:text-chalk [@media(pointer:coarse)]:min-h-11";

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
  const [unanswered, unread] = user
    ? await Promise.all([totalUnanswered(await unansweredQuestions(supabase, user.id)), unreadConversations(supabase, user.id)])
    : [0, 0];

  const now = Date.now();
  // The phone menu, after the "Sell a car" button (DECISIONS.md point 8). About is in
  // the footer and Notifications under the bell, so neither is here.
  const menuLinks: MenuLink[] = [
    { label: "Auctions", href: "/" },
    { label: "How it works", href: "/how-it-works" },
    ...(user
      ? [
          { label: "My listings", href: "/account/listings", count: unanswered },
          { label: "My purchases", href: "/account/purchases" },
          { label: "Messages", href: "/account/messages", count: unread, countKind: "unread" as const },
          { label: "Watchlist", href: "/account/watchlist" },
          { label: username ? `Profile (${username})` : "Finish profile", href: "/account/setup" },
          ...(isAdmin ? [{ label: "Admin", href: "/admin" }] : []),
        ]
      : [{ label: "Sign in", href: "/login" }]),
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
          <MobileMenu links={menuLinks} signedIn={Boolean(user)} email={user?.email ?? null} />
        </div>

        <nav aria-label="Main" className="hidden items-center gap-1 text-sm sm:flex">
          <NavLink href="/" className={navLink}>
            Auctions
          </NavLink>
          <NavLink href="/how-it-works" className={`${navLink} hidden md:inline-flex`}>
            How it works
          </NavLink>
          <NavLink href="/sell" className={`${SELL_BUTTON} mx-1 min-h-10 text-sm [@media(pointer:coarse)]:min-h-11`}>
            Sell a car
          </NavLink>
          {user ? (
            <>
              <NotificationBell userId={user.id} initialNow={now} />
              <AccountMenu label={username ?? "Finish profile"} email={user.email ?? null} isAdmin={isAdmin} unanswered={unanswered} unread={unread} />
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

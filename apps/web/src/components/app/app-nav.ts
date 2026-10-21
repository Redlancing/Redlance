import {
  ChartNoAxesColumn,
  Inbox,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Settings,
  UserRound,
} from "lucide-react";

export type AppNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  soon?: boolean;
  /** false: kept out of the phone tab bar (Settings lives in the phone top bar instead). */
  phoneTab?: false;
};

// Nav links never prefetch: every app page is dynamic, and Next's viewport prefetch would build
// each one (with its queries) on every page load just because the link is on screen.
// Items marked `soon` light up as each feature ships (onboarding, matching, tracker…).
export const appNav: AppNavItem[] = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Matches", href: "/feed", icon: Inbox },
  { title: "Tracker", href: "/tracker", icon: ListChecks },
  { title: "Insights", href: "/insights", icon: ChartNoAxesColumn },
  { title: "Profile", href: "/profile", icon: UserRound },
  { title: "Settings", href: "/settings", icon: Settings, phoneTab: false },
];

/** The mobile tab bar: five built items; Settings is in the phone top bar. */
export const appTabs: AppNavItem[] = appNav.filter(
  (item) => !item.soon && item.phoneTab !== false,
);

/** A page is under an item when its path is the item's href or a sub-path (`/feed/x` → `/feed`). */
export function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

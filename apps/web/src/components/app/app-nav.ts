import {
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
};

// Items marked `soon` light up as each feature ships (onboarding, matching, tracker…).
export const appNav: AppNavItem[] = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Matches", href: "/dashboard/matches", icon: Inbox, soon: true },
  {
    title: "Tracker",
    href: "/dashboard/tracker",
    icon: ListChecks,
    soon: true,
  },
  { title: "Profile", href: "/dashboard/profile", icon: UserRound, soon: true },
  {
    title: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    soon: true,
  },
];

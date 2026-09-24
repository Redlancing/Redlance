"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { primaryLinks, productMenu, type NavItem } from "@/lib/nav";

const topLevel = cn(
  navigationMenuTriggerStyle(),
  "h-9 rounded-[10px] px-3 text-[15px] tracking-[-0.01em] text-foreground/85 hover:bg-muted hover:text-foreground",
);

function MenuItem({ item }: { item: NavItem }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em]">
        {item.title}
        {!item.href && (
          <span className="rounded-md bg-flare-50 px-1.5 py-px text-xs font-medium text-flare-700">
            Soon
          </span>
        )}
      </span>
      {item.description && (
        <span className="text-sm leading-snug text-muted-foreground">
          {item.description}
        </span>
      )}
    </>
  );

  if (!item.href) {
    return (
      <div className="flex flex-col gap-0.5 px-3 py-2.5 text-foreground/70">
        {body}
      </div>
    );
  }

  return (
    <NavigationMenuLink
      closeOnClick
      render={<Link href={item.href} />}
      className="flex-col items-start gap-0.5 rounded-[10px] px-3 py-2.5 text-foreground"
    >
      {body}
    </NavigationMenuLink>
  );
}

export function MainNav({ className }: { className?: string }) {
  return (
    <NavigationMenu className={className}>
      <NavigationMenuList className="gap-0.5">
        <NavigationMenuItem>
          <NavigationMenuTrigger className={topLevel}>
            Product
          </NavigationMenuTrigger>
          <NavigationMenuContent className="p-0">
            <div className="grid w-[min(62rem,calc(100vw-3rem))] grid-cols-[repeat(3,minmax(0,1fr))_15rem] gap-2 p-3">
              {productMenu.columns.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  <p className="px-3 pt-2 pb-1 text-[13px] text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map((item) => (
                    <MenuItem key={item.title} item={item} />
                  ))}
                </div>
              ))}
              <div className="flex flex-col gap-4 rounded-xl bg-cream p-2">
                {productMenu.side.map((group) => (
                  <div key={group.label} className="flex flex-col">
                    <p className="px-3 pt-2 pb-1 text-[13px] text-muted-foreground">
                      {group.label}
                    </p>
                    {group.items.map((item) => (
                      <NavigationMenuLink
                        key={item.title}
                        closeOnClick
                        render={<Link href={item.href!} />}
                        className="rounded-[10px] px-3 py-2 text-[15px] font-medium tracking-[-0.01em] text-foreground hover:bg-background"
                      >
                        {item.title}
                      </NavigationMenuLink>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        {primaryLinks.map((link) => (
          <NavigationMenuItem key={link.title}>
            <NavigationMenuLink
              render={<Link href={link.href!} />}
              className={topLevel}
            >
              {link.title}
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

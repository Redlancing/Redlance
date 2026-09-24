"use client";

import Link from "next/link";
import { MenuIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Logo } from "@/components/brand/logo";
import { authLinks, primaryLinks, productMenu } from "@/lib/nav";
import { cn } from "@/lib/utils";

const linkClass =
  "flex min-h-11 items-center rounded-[10px] px-3 text-base font-medium tracking-[-0.01em] text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function MobileNav({ className }: { className?: string }) {
  const productLinks = productMenu.columns
    .flatMap((group) => group.items)
    .filter((item) => item.href);
  const nicheLinks = productMenu.side[0].items;

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Open menu"
            className={className}
          />
        }
      >
        <MenuIcon aria-hidden="true" className="size-5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-sm">
        <div className="flex h-16 items-center border-b border-border px-4">
          <SheetTitle render={<div />}>
            <Logo className="text-xl" />
          </SheetTitle>
        </div>
        <nav
          aria-label="Main"
          className="flex flex-1 flex-col gap-6 overflow-y-auto px-2 py-4"
        >
          <div className="flex flex-col">
            {primaryLinks.map((link) => (
              <SheetClose
                key={link.title}
                nativeButton={false}
                render={<Link href={link.href!} className={linkClass} />}
              >
                {link.title}
              </SheetClose>
            ))}
          </div>
          <div className="flex flex-col">
            <p className="px-3 pb-1 text-[13px] text-muted-foreground">
              Product
            </p>
            {productLinks.map((item) => (
              <SheetClose
                key={item.title}
                nativeButton={false}
                render={<Link href={item.href!} className={linkClass} />}
              >
                {item.title}
              </SheetClose>
            ))}
          </div>
          <div className="flex flex-col">
            <p className="px-3 pb-1 text-[13px] text-muted-foreground">
              Redlance for
            </p>
            {nicheLinks.map((item) => (
              <SheetClose
                key={item.title}
                nativeButton={false}
                render={<Link href={item.href!} className={linkClass} />}
              >
                {item.title}
              </SheetClose>
            ))}
          </div>
        </nav>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
          <Link
            href={authLinks.logIn.href}
            className={cn(buttonVariants({ variant: "outline", size: "xl" }))}
          >
            {authLinks.logIn.title}
          </Link>
          <Link
            href={authLinks.signUp.href}
            className={cn(buttonVariants({ size: "xl" }))}
          >
            {authLinks.signUp.title}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

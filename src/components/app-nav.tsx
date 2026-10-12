"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { BookOpen, CalendarDays, ListChecks, LogOut, Settings, Utensils } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Tonight", icon: Utensils, match: (p: string) => p === "/" },
  { href: "/week", label: "Week", icon: CalendarDays, match: (p: string) => p === "/week" || p.startsWith("/day/") },
  { href: "/grocery", label: "Groceries", icon: ListChecks, match: (p: string) => p.startsWith("/grocery") },
  { href: "/library", label: "Library", icon: BookOpen, match: (p: string) => p.startsWith("/library") },
];

/** Floating tab bar on phones; the same tabs sit in the header from `md` up. */
export function AppNav({ placement }: { placement: "bottom" | "top" }) {
  const pathname = usePathname();
  const bottom = placement === "bottom";
  return (
    <nav
      aria-label="Main"
      className={cn(
        bottom
          ? "fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md gap-1 rounded-full bg-nav p-1.5 shadow-lg shadow-black/15 md:hidden"
          : "hidden items-center gap-1 md:flex",
      )}
    >
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            // Inactive tabs show only their icon on phones, so the name comes from aria-label.
            aria-label={bottom && !active ? label : undefined}
            className={cn(
              "flex h-12 items-center justify-center gap-1.5 rounded-full text-sm font-bold transition-colors md:h-9 md:px-3.5",
              // The active tab grows to fit its label; the rest share what is left.
              bottom && (active ? "flex-[1.6] px-3" : "flex-1"),
              bottom
                ? active
                  ? "bg-primary text-primary-foreground"
                  : "text-nav-foreground hover:text-white"
                : active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-5 shrink-0 md:size-4" aria-hidden />
            {(!bottom || active) && label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Avatar button with Settings (adults) and Sign out. */
export function AccountMenu({ displayName, isAdult }: { displayName: string; isAdult: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="flex size-11 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:size-9 md:text-sm"
      >
        {displayName.slice(0, 1).toUpperCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {isAdult && (
          <DropdownMenuLinkItem render={<Link href="/settings" />} closeOnClick className="min-h-11 md:min-h-9">
            <Settings /> Settings
          </DropdownMenuLinkItem>
        )}
        <DropdownMenuItem
          disabled={pending}
          onClick={() => startTransition(() => logoutAction())}
          className="min-h-11 md:min-h-9"
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

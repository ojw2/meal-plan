import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** "‹ Week" above a page title: back to the screen this one was opened from. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-1.5 inline-flex min-h-11 items-center gap-0.5 self-start pr-2 text-sm font-semibold text-muted-foreground hover:text-foreground md:min-h-9"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}

import Link from "next/link";
import { Utensils } from "lucide-react";
import { AccountMenu, AppNav } from "@/components/app-nav";
import { LiveSync } from "@/components/live-sync";
import { Toaster } from "@/components/ui/sonner";
import { requireUser } from "@/lib/auth/dal";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    // Keeps every screen in sync with changes made on other devices (SPEC §5).
    <LiveSync>
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2 lg:[body:has([data-wide])_&]:max-w-6xl">
          <Link href="/" className="mr-auto flex items-center gap-2 py-1.5 text-lg font-extrabold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Utensils className="size-4" aria-hidden />
            </span>
            Meal Plan
          </Link>
          <AppNav placement="top" />
          <AccountMenu displayName={user.displayName} isAdult={user.role === "adult"} />
        </div>
      </header>
      {/* Pages opt into a wider desktop layout (e.g. the week grid) with a data-wide child.
          Bottom padding keeps content clear of the floating tab bar on phones. */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-2 pb-32 md:pb-10 lg:has-data-wide:max-w-6xl">
        {children}
      </main>
      <AppNav placement="bottom" />
      <Toaster position="top-center" />
    </LiveSync>
  );
}

import Link from "next/link";
import { LiveSync } from "@/components/live-sync";
import { Button, buttonVariants } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { requireUser } from "@/lib/auth/dal";
import { logoutAction } from "../(auth)/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    // Keeps every screen in sync with changes made on other devices (SPEC §5).
    <LiveSync>
      <header className="border-b">
        <nav className="mx-auto flex w-full max-w-3xl items-center gap-1 px-4 py-2">
          <Link href="/" className="mr-auto py-2 font-semibold">
            Meal Plan
          </Link>
          <Link href="/week" className={buttonVariants({ variant: "ghost" })}>
            Week
          </Link>
          <Link href="/library" className={buttonVariants({ variant: "ghost" })}>
            Library
          </Link>
          {user.role === "adult" && (
            <Link href="/settings" className={buttonVariants({ variant: "ghost" })}>
              Settings
            </Link>
          )}
          <form action={logoutAction}>
            <Button variant="ghost" type="submit">
              Sign out
            </Button>
          </form>
        </nav>
      </header>
      {/* Pages opt into a wider desktop layout (e.g. the week grid) with a data-wide child. */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 lg:has-data-wide:max-w-6xl">{children}</main>
      <Toaster position="top-center" />
    </LiveSync>
  );
}

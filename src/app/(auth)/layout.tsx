import { Utensils } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2.5 self-center text-2xl font-extrabold tracking-tight">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Utensils className="size-5" aria-hidden />
        </span>
        Meal Plan
      </div>
      {children}
    </main>
  );
}

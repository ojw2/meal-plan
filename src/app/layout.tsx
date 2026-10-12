import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Meal Plan", template: "%s · Meal Plan" },
  description: "Plan the week's dinners and who's cooking.",
  applicationName: "Meal Plan",
  // Installed to the iOS home screen, open full screen like an app.
  appleWebApp: { capable: true, title: "Meal Plan", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    // Matches --background in globals.css.
    { media: "(prefers-color-scheme: light)", color: "#f4f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#101511" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}

import type { MetadataRoute } from "next";
import { ICON_BACKGROUND } from "@/lib/pwa/icon-art";

/** Makes the app installable to a phone's home screen (SPEC §7). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Meal Plan",
    short_name: "Meal Plan",
    description: "Plan the week's dinners and who's cooking.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f1",
    theme_color: ICON_BACKGROUND,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

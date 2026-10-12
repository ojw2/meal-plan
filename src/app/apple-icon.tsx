import { iconResponse } from "@/lib/pwa/icon-art";

// iOS "Add to Home Screen" uses this rather than the manifest icons.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return iconResponse(size.width);
}

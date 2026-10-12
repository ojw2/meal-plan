import { iconResponse } from "@/lib/pwa/icon-art";

// Served at /icon/192 and /icon/512; the manifest lists both.
export function generateImageMetadata() {
  return [192, 512].map((n) => ({ id: String(n), contentType: "image/png", size: { width: n, height: n } }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  return iconResponse(Number(await id));
}

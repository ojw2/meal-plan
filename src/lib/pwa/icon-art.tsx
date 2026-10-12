import { ImageResponse } from "next/og";

/** Matches the app's herb green (`--primary` in globals.css). */
export const ICON_BACKGROUND = "#2f6b3a";

/**
 * The app icon: a white fork and knife on a green square. The glyph sits in
 * the middle 50%, inside the maskable safe zone, so one image serves both
 * "any" and "maskable".
 */
export function iconResponse(size: number) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: ICON_BACKGROUND,
        }}
      >
        {/* Lucide "utensils". */}
        <svg
          width={size * 0.5}
          height={size * 0.5}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
          <path d="M7 2v20" />
          <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}

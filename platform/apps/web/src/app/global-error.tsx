"use client";

import { useEffect } from "react";

/**
 * Epic 19 (Production Hardening), UI item 1 — the last-resort boundary: a
 * crash inside the root layout itself (everything else in this app has its
 * own nearer `error.tsx`, which never reaches here). Next.js requires this
 * file to render its own complete `<html>`/`<body>` and does NOT include
 * this app's global stylesheet or fonts here (`error.md`'s own "Good to
 * know") — so the colors below are a hand-picked, self-contained subset of
 * `@bebest/ui`'s real light/dark token values (`packages/ui/src/styles/
 * tokens.css`), not a guess, kept in sync manually since this file can't
 * import that stylesheet.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "root_layout_error_boundary",
        message: error.message,
        digest: error.digest,
      }),
    );
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
          background: "#faf9f6",
          color: "#211c16",
          colorScheme: "light dark",
        }}
      >
        <style
          // A crash-page-only stylesheet — kept inline since this document
          // never gets the app's real one. Handles dark mode the same
          // token values `tokens.css` use, so a broken root layout still
          // roughly matches the viewer's OS theme instead of blinding a
          // dark-mode user with a white page.
          dangerouslySetInnerHTML={{
            __html: `
              @media (prefers-color-scheme: dark) {
                body { background: #0d0a07 !important; color: #faf9f6 !important; }
                .ge-card { border-color: #362f26 !important; }
                .ge-btn-outline { border-color: #362f26 !important; color: #faf9f6 !important; }
              }
            `,
          }}
        />
        <div className="ge-card" style={{ maxWidth: 420, textAlign: "center", display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              margin: "0 auto",
              borderRadius: "9999px",
              border: "1px solid #a1402f4d",
              background: "#f2ded9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              color: "#a1402f",
            }}
          >
            !
          </div>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>BeBest hit a problem</h1>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 8, opacity: 0.75 }}>
              Something went wrong loading the app. Your data is safe on our servers — try again, or reload the page.
            </p>
            {error.digest && (
              <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, opacity: 0.5, marginTop: 8 }}>
                Reference: {error.digest}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              type="button"
              onClick={retry}
              style={{
                height: 36,
                padding: "0 16px",
                borderRadius: 6,
                border: "none",
                background: "#3e7f5c",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              className="ge-btn-outline"
              onClick={() => {
                // A full reload, deliberately not `useRouter().push()` — the
                // root layout itself just crashed, so its providers/router
                // context can't be trusted to still work. Forcing a real
                // navigation is the one recovery path guaranteed to work
                // here.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = "/overview";
              }}
              style={{
                height: 36,
                padding: "0 16px",
                borderRadius: 6,
                border: "1px solid #e2ddd0",
                background: "transparent",
                color: "#211c16",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

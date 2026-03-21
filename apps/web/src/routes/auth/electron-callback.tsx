import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/auth/electron-callback")({
  component: ElectronCallback,
});

function ElectronCallback() {
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    fetch("/api/auth/convex/token")
      .then((r) => r.json())
      .then((data: unknown) => {
        const token = (data as { token?: string })?.token;
        if (token) {
          setDeepLinkUrl(`wow-dashboard://auth#token=${encodeURIComponent(token)}`);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, []);

  // Auto-click the hidden anchor once the URL is ready — this counts as a user-gesture
  // chain from the original page load and is the most reliable way to trigger custom protocols.
  useEffect(() => {
    if (deepLinkUrl && anchorRef.current) {
      anchorRef.current.click();
    }
  }, [deepLinkUrl]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium">Login failed</p>
        <p className="text-muted-foreground text-sm">
          Could not retrieve session token. Please try logging in again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <p className="text-lg font-medium">Login successful!</p>
      <p className="text-muted-foreground text-sm">Returning to the app…</p>
      {deepLinkUrl && (
        <>
          {/* Hidden anchor auto-clicked above */}
          <a ref={anchorRef} href={deepLinkUrl} className="hidden" />
          {/* Visible fallback in case the browser blocked the auto-click */}
          <a
            href={deepLinkUrl}
            className="mt-2 text-sm underline"
          >
            Click here if the app didn&apos;t open automatically
          </a>
        </>
      )}
    </div>
  );
}

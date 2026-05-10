import { createFileRoute } from "@tanstack/react-router";
import { env } from "@wow-dashboard/env/web";
import { useEffect, useRef, useState } from "react";

import { apiClient } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/auth/electron-callback")({
  component: ElectronCallback,
});

function getDesktopLoginCompleteUrl() {
  const url = new URL(env.VITE_API_URL);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/auth/desktop-login/complete`;
  return url.toString();
}

function readAttemptId() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("attemptId")?.trim() ?? "";
}

function ElectronCallback() {
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legacyComplete, setLegacyComplete] = useState(false);
  const [attemptId] = useState(readAttemptId);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const session = authClient.useSession();

  useEffect(() => {
    if (session.isPending || deepLinkUrl || legacyComplete) return;
    if (!session.data) {
      setError("Could not retrieve session token. Please try logging in again.");
      return;
    }

    if (attemptId) {
      fetch(getDesktopLoginCompleteUrl(), {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ attemptId }),
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!response.ok) {
            throw new Error(
              payload?.error ?? `Desktop login completion failed: ${response.status}`,
            );
          }
          setLegacyComplete(true);
          window.setTimeout(() => window.close(), 300);
        })
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not retrieve session token. Please try logging in again.",
          ),
        );
      return;
    }

    apiClient
      .createLoginCode()
      .then((data) => {
        setDeepLinkUrl(`wow-dashboard://auth?code=${encodeURIComponent(data.code)}`);
      })
      .catch(() => setError("Could not retrieve session token. Please try logging in again."));
  }, [attemptId, deepLinkUrl, legacyComplete, session.data, session.isPending]);

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
        <p className="text-muted-foreground text-sm">{error}</p>
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
          <a href={deepLinkUrl} className="mt-2 text-sm underline">
            Click here if the app didn&apos;t open automatically
          </a>
        </>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { env } from "@wow-dashboard/env/web";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/auth/electron-login")({
  component: ElectronLogin,
});

function getOAuthBootstrapUrl() {
  const url = new URL(env.VITE_API_URL);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/auth/sign-in/oauth2`;
  return url.toString();
}

function buildElectronCallbackUrl() {
  const callbackUrl = new URL("/auth/electron-callback", window.location.origin);
  const attemptId = new URLSearchParams(window.location.search).get("attemptId");
  if (attemptId) {
    callbackUrl.searchParams.set("attemptId", attemptId);
  }
  return callbackUrl.toString();
}

function ElectronLogin() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startOAuth() {
      try {
        const response = await fetch(getOAuthBootstrapUrl(), {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            providerId: "battlenet",
            callbackURL: buildElectronCallbackUrl(),
          }),
        });

        const rawBody = await response.text();
        let data: { url?: string; error?: string } = {};
        try {
          data = JSON.parse(rawBody) as { url?: string; error?: string };
        } catch {
          data = {};
        }

        if (!response.ok || !data.url) {
          throw new Error(
            data.error ??
              (rawBody.startsWith("<!DOCTYPE") || rawBody.startsWith("<html")
                ? `OAuth bootstrap hit the wrong server: ${response.status}`
                : `OAuth bootstrap failed: ${response.status}`),
          );
        }

        if (!cancelled) {
          window.location.assign(data.url);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not start Battle.net auth");
        }
      }
    }

    void startOAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-muted-foreground text-sm">Redirecting to Battle.net…</p>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}

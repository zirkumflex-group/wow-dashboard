import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/auth/electron-login")({
  component: ElectronLogin,
});

function ElectronLogin() {
  useEffect(() => {
    void authClient.signIn.social({
      provider: "battlenet",
      callbackURL: "/auth/electron-callback",
    });
  }, []);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground text-sm">Redirecting to Battle.net…</p>
    </div>
  );
}

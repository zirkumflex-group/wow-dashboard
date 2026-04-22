import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@wow-dashboard/ui/components/button";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function RedirectToDashboard() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/dashboard" });
  }, [navigate]);
  return null;
}

function HomeComponent() {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (session.data) {
    return <RedirectToDashboard />;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">WoW Dashboard</h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Track your characters across all realms
        </p>
      </div>
      <Button
        size="lg"
        onClick={() =>
          authClient.signIn.social({
            provider: "battlenet",
            callbackURL: new URL("/dashboard", window.location.origin).toString(),
          })
        }
      >
        Sign in with Battle.net
      </Button>
    </div>
  );
}

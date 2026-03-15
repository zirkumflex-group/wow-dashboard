import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@wow-dashboard/ui/components/button";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
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
  return (
    <>
      <Authenticated>
        <RedirectToDashboard />
      </Authenticated>
      <Unauthenticated>
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
                callbackURL: "/dashboard",
              })
            }
          >
            Sign in with Battle.net
          </Button>
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </AuthLoading>
    </>
  );
}

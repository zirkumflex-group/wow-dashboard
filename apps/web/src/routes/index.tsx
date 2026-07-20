import { createFileRoute, redirect } from "@tanstack/react-router";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent } from "@wow-dashboard/ui/components/card";
import ChartNoAxesCombined from "lucide-react/dist/esm/icons/chart-no-axes-combined.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import UploadCloud from "lucide-react/dist/esm/icons/upload-cloud.mjs";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

const SAMPLE_METRICS = [
  { label: "Item Level", value: "639.4", detail: "+2.8" },
  { label: "M+ Score", value: "2,418", detail: "+96" },
  { label: "Vault Slots", value: "6 / 9", detail: "2 ready" },
  { label: "Tracked", value: "128", detail: "snapshots" },
] as const;

const SAMPLE_CHART_HEIGHTS = [28, 34, 31, 46, 55, 52, 68, 61, 76, 82, 79, 91] as const;

const FEATURES = [
  {
    Icon: ChartNoAxesCombined,
    title: "Historical Context",
    description: "Understand change instead of reading isolated values.",
  },
  {
    Icon: UploadCloud,
    title: "Addon Snapshots",
    description: "Capture the in-game details public APIs cannot provide.",
  },
  {
    Icon: ShieldCheck,
    title: "Account Scoped",
    description: "Private data stays behind authenticated ownership checks.",
  },
] as const;

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [{ title: "WoW Dashboard | Character Progression, Clearly" }],
  }),
  component: HomeComponent,
});

function HomeComponent() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  async function handleSignIn() {
    if (isSigningIn) return;

    setIsSigningIn(true);
    setSignInError(null);
    try {
      const result = await authClient.signIn.oauth2({
        providerId: "battlenet",
        callbackURL: new URL("/dashboard", window.location.origin).toString(),
      });
      if (result.error) {
        throw new Error("Could not start Battle.net sign-in. Please try again.");
      }
    } catch {
      setSignInError("Could not start Battle.net sign-in. Check your connection and try again.");
      setIsSigningIn(false);
    }
  }

  return (
    <div className="analytics-shell mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between border-b border-border/70 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-primary/35 bg-primary/10 font-mono text-sm font-bold text-primary">
            WD
          </div>
          <div>
            <p className="font-semibold leading-none">WoW Dashboard</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Self-Hosted Character Intelligence
            </p>
          </div>
        </div>
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          Battle.net OAuth
        </span>
      </header>

      <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
        <section className="max-w-2xl">
          <p className="analytics-kicker text-primary">Progression / Mythic+ / Snapshots</p>
          <h1 className="mt-4 max-w-xl text-pretty text-4xl font-bold tracking-[-0.045em] sm:text-5xl lg:text-6xl">
            Your Characters, Readable at a Glance.
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            Follow item level, score, currencies, playtime, Great Vault progress, and addon-captured
            runs from one private dashboard.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={isSigningIn} onClick={() => void handleSignIn()}>
              {isSigningIn ? "Opening Battle.net…" : "Sign In with Battle.net"}
            </Button>
            <p className="max-w-xs text-xs leading-5 text-muted-foreground">
              Authentication and character access remain scoped to your account.
            </p>
            {signInError && (
              <p className="w-full text-sm text-destructive" role="status" aria-live="polite">
                {signInError}
              </p>
            )}
          </div>
        </section>

        <Card className="analytics-hero relative">
          <CardContent className="relative z-10 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="analytics-kicker">Character Signal</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">Arcanist · EU</p>
              </div>
              <span className="rounded-sm border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                Live Snapshot
              </span>
            </div>
            <div className="section-divider my-6" />
            <div className="grid grid-cols-2 gap-3">
              {SAMPLE_METRICS.map(({ label, value, detail }) => (
                <div key={label} className="analytics-panel rounded-md border p-3.5">
                  <p className="analytics-kicker text-[9px]">{label}</p>
                  <p className="analytics-number mt-2 text-2xl font-semibold">{value}</p>
                  <p className="mt-1 font-mono text-[10px] text-primary">{detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 h-28 overflow-hidden rounded-md border border-border/70 bg-background/55 p-3">
              <div className="flex h-full items-end gap-1" aria-hidden="true">
                {SAMPLE_CHART_HEIGHTS.map((height) => (
                  <span
                    key={height}
                    className="flex-1 bg-primary/70"
                    style={{
                      height: `${height}%`,
                      maskImage:
                        "radial-gradient(circle at 1px 1px, black 1px, transparent 1.25px)",
                      maskSize: "4px 4px",
                    }}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-px overflow-hidden rounded-md border border-border/70 bg-border/70 sm:grid-cols-3">
        {FEATURES.map(({ Icon, title, description }) => (
          <div key={title} className="flex gap-3 bg-card p-4">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          </div>
        ))}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 py-5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>WoW Dashboard</span>
        <span>World of Warcraft is a trademark of Blizzard Entertainment.</span>
      </footer>
    </div>
  );
}

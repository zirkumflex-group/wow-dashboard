import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Checkbox } from "@wow-dashboard/ui/components/checkbox";
import { Input } from "@wow-dashboard/ui/components/input";
import Laptop from "lucide-react/dist/esm/icons/laptop.mjs";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import Smartphone from "lucide-react/dist/esm/icons/smartphone.mjs";
import { useState } from "react";
import { toast } from "sonner";
import type { MeResponse } from "@wow-dashboard/api-schema";
import { apiClient, apiQueryOptions } from "@/lib/api-client";
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from "@/lib/format";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(apiQueryOptions.me()),
  component: SettingsPage,
});

type PlayerSettings = NonNullable<MeResponse["player"]>;

function DiscordPrivacySettings({ player }: { player: PlayerSettings }) {
  const queryClient = useQueryClient();
  const [discordUserId, setDiscordUserId] = useState(player.discordUserId ?? "");
  const [shareDiscord, setShareDiscord] = useState(player.shareDiscordInBoosterExport);
  const saveSettings = useMutation({
    mutationFn: () =>
      apiClient.updatePlayerDiscordUserId(player.id, {
        discordUserId: discordUserId.trim() === "" ? null : discordUserId.trim(),
        shareDiscordInBoosterExport: shareDiscord && discordUserId.trim() !== "",
      }),
    onSuccess: (updatedPlayer) => {
      queryClient.setQueryData<MeResponse>(apiQueryOptions.me().queryKey, (current) =>
        current
          ? {
              ...current,
              player: current.player
                ? {
                    ...current.player,
                    discordUserId: updatedPlayer.discordUserId,
                    shareDiscordInBoosterExport: updatedPlayer.shareDiscordInBoosterExport,
                  }
                : null,
            }
          : current,
      );
      setShareDiscord(updatedPlayer.shareDiscordInBoosterExport);
      toast.success("Discord privacy settings saved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save Discord settings");
    },
  });

  return (
    <Card className="analytics-panel">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Booster export privacy
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your BattleTag remains visible on public booster characters. Your Discord ID is included
          only when you explicitly opt in.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <label className="block space-y-2">
          <span className="text-sm font-medium">Discord user ID</span>
          <Input
            value={discordUserId}
            onChange={(event) => setDiscordUserId(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="123456789012345678"
          />
          <span className="block text-xs text-muted-foreground">
            Use the numeric user ID or a Discord mention. Clearing it also disables sharing.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
          <Checkbox
            checked={shareDiscord && discordUserId.trim() !== ""}
            disabled={discordUserId.trim() === ""}
            onCheckedChange={(checked) => setShareDiscord(checked === true)}
            aria-label="Share Discord ID in booster exports"
          />
          <span>
            <span className="block text-sm font-semibold">
              Share in authenticated booster exports
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              Signed-in dashboard users can copy your Discord mention alongside your public booster
              characters. You can revoke this consent at any time.
            </span>
          </span>
        </label>

        <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
          {saveSettings.isPending ? (
            <Loader2
              aria-hidden="true"
              className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
            />
          ) : null}
          Save privacy settings
        </Button>
      </CardContent>
    </Card>
  );
}

function describeSession(userAgent: string | null | undefined) {
  const normalized = userAgent?.toLowerCase() ?? "";
  if (normalized.includes("wow-dashboard-desktop")) {
    return { label: "Desktop app", icon: Laptop };
  }
  if (
    normalized.includes("mobile") ||
    normalized.includes("android") ||
    normalized.includes("iphone")
  ) {
    return { label: "Mobile browser", icon: Smartphone };
  }
  return { label: "Web browser", icon: Laptop };
}

function ActiveSessions() {
  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () => apiClient.getActiveSessions(),
  });
  const queryClient = useQueryClient();
  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => apiClient.revokeActiveSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
      toast.success("Session revoked");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not revoke session");
    },
  });

  return (
    <Card className="analytics-panel">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="text-base">Active sessions</CardTitle>
        <p className="text-sm text-muted-foreground">
          Review signed-in browsers and desktop clients, and revoke anything you no longer use.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-6">
        {sessions.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2
              aria-hidden="true"
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
            />{" "}
            Loading sessions…
          </div>
        ) : sessions.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-destructive">Could not load active sessions.</p>
            <Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>
              Try Again
            </Button>
          </div>
        ) : sessions.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions were returned.</p>
        ) : (
          sessions.data.map((session) => {
            const description = describeSession(session.userAgent);
            const Icon = description.icon;
            return (
              <div
                key={session.id}
                className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{description.label}</p>
                      {session.isCurrent ? <Badge variant="outline">Current</Badge> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {session.userAgent || "Unknown device"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Expires{" "}
                      {new Date(session.expiresAt).toLocaleString(DISPLAY_LOCALE, {
                        timeZone: DISPLAY_TIME_ZONE,
                        timeZoneName: "short",
                      })}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokeSession.isPending || session.isCurrent}
                  onClick={() => revokeSession.mutate(session.id)}
                >
                  {session.isCurrent ? "Current session" : "Revoke"}
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function SettingsPage() {
  const me = useQuery(apiQueryOptions.me());

  return (
    <div className="analytics-shell w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-2">
        <p className="analytics-kicker text-primary">Account / Privacy / Sessions</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage privacy and signed-in devices for your account.
        </p>
      </div>

      {me.data?.player ? (
        <DiscordPrivacySettings
          key={`${me.data.player.id}:${me.data.player.discordUserId ?? ""}:${me.data.player.shareDiscordInBoosterExport}`}
          player={me.data.player}
        />
      ) : me.isPending ? (
        <Card className="analytics-panel p-6 text-sm text-muted-foreground">
          Loading account settings…
        </Card>
      ) : me.isError ? (
        <Card className="analytics-panel border-destructive/40 p-6">
          <p className="text-sm text-muted-foreground">Account settings could not be loaded.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => void me.refetch()}>
            Try Again
          </Button>
        </Card>
      ) : (
        <Card className="analytics-panel p-6 text-sm text-muted-foreground">
          Your Battle.net player profile is not linked yet. Sign in again to repair the connection.
        </Card>
      )}

      <ActiveSessions />
    </div>
  );
}

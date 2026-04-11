import { createFileRoute, redirect } from "@tanstack/react-router";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="w-full max-w-3xl space-y-6 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.12),_transparent_45%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your dashboard preferences</p>
      </div>

      <Card className="border-zinc-800/90 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 shadow-lg">
        <CardHeader className="border-b border-zinc-800/80 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            Appearance
            <Badge variant="outline" className="border-amber-400/40 bg-amber-500/10 text-amber-300">
              Dark Only
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The dashboard now runs in a single dark theme for visual consistency.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-4">
            <p className="text-sm font-semibold text-zinc-100">Dark mode is always enabled</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Light mode and custom color variants were removed to keep the UI focused and avoid
              unused theme complexity.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

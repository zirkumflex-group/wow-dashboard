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
    <div className="w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your dashboard preferences</p>
      </div>

      <Card className="border-border/70 bg-card">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            Appearance
            <Badge variant="outline" className="border-zinc-600 bg-zinc-900 text-zinc-200">
              Dark Only
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The dashboard now runs in a single dark theme for visual consistency.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-semibold text-foreground">Dark mode is always enabled</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Light mode and custom color variants were removed to keep the UI focused and avoid
              unused theme complexity.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { CheckIcon } from "lucide-react";
import { cn } from "@wow-dashboard/ui/lib/utils";
import { type Theme, THEMES, useTheme } from "@/components/theme-provider";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

// Static color swatches per theme for the preview card
const THEME_PREVIEW: Record<
  Theme,
  { bg: string; card: string; primary: string; muted: string; label: string }
> = {
  light: {
    bg: "#ffffff",
    card: "#f8f8fb",
    primary: "#7c3aed",
    muted: "#f4f4f5",
    label: "Light",
  },
  dark: {
    bg: "#1f2937",
    card: "#374151",
    primary: "#6d28d9",
    muted: "#374151",
    label: "Dark",
  },
  auto: {
    bg: "linear-gradient(135deg, #ffffff 50%, #1f2937 50%)",
    card: "#e5e7eb",
    primary: "#7c3aed",
    muted: "#f4f4f5",
    label: "Auto",
  },
  ember: {
    bg: "#1c100a",
    card: "#2a1a0e",
    primary: "#d97706",
    muted: "#2e1d10",
    label: "Ember",
  },
  arcane: {
    bg: "#0a1520",
    card: "#102030",
    primary: "#0d9488",
    muted: "#122030",
    label: "Arcane",
  },
};

function ThemePreviewCard({
  id,
  label,
  description,
}: {
  id: Theme;
  label: string;
  description: string;
}) {
  const { theme, setTheme } = useTheme();
  const isActive = theme === id;
  const preview = THEME_PREVIEW[id];

  return (
    <button
      onClick={() => setTheme(id)}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border-2 p-4 text-left transition-all hover:shadow-md",
        isActive
          ? "border-primary bg-primary/5 shadow-md"
          : "border-border hover:border-primary/40",
      )}
    >
      {/* Mini UI preview */}
      <div
        className="relative h-24 w-full overflow-hidden rounded-lg"
        style={{ background: preview.bg }}
      >
        {/* Fake sidebar */}
        <div
          className="absolute left-0 top-0 h-full w-10 rounded-l-lg opacity-80"
          style={{ background: preview.card }}
        />
        {/* Fake content area */}
        <div className="absolute left-12 top-3 right-3 flex flex-col gap-1.5">
          {/* Fake card */}
          <div className="h-10 rounded-md opacity-90" style={{ background: preview.card }} />
          <div className="flex gap-1.5">
            <div
              className="h-6 flex-1 rounded-md opacity-70"
              style={{ background: preview.muted }}
            />
            <div
              className="h-6 flex-1 rounded-md opacity-70"
              style={{ background: preview.muted }}
            />
          </div>
        </div>
        {/* Primary color accent dot */}
        <div
          className="absolute left-[14px] top-3 h-2.5 w-2.5 rounded-full"
          style={{ background: preview.primary }}
        />
        <div
          className="absolute left-[14px] top-7 h-2.5 w-2.5 rounded-full opacity-50"
          style={{ background: preview.primary }}
        />
      </div>

      {/* Label row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            isActive ? "border-primary bg-primary text-primary-foreground" : "border-border",
          )}
        >
          {isActive && <CheckIcon size={10} strokeWidth={3} />}
        </div>
      </div>
    </button>
  );
}

function SettingsPage() {
  const { theme } = useTheme();

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your preferences</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Appearance</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose how WoW Dashboard looks. Currently using{" "}
              <span className="font-medium text-foreground capitalize">{theme}</span> theme.
            </p>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {THEMES.map((t) => (
                <ThemePreviewCard
                  key={t.id}
                  id={t.id}
                  label={t.label}
                  description={t.description}
                />
              ))}
            </div>

            {/* Custom theme descriptions */}
            <div className="mt-6 grid gap-3 sm:grid-cols-2 border-t border-border/50 pt-6">
              <div className="rounded-lg bg-muted/30 p-4 border border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-3 w-3 rounded-full bg-amber-500" />
                  <p className="text-sm font-semibold">Ember</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Deep amber and copper tones evoking the warmth of a forge. Inspired by WoW's fire
                  and blacksmithing aesthetic.
                </p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4 border border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-3 w-3 rounded-full bg-teal-400" />
                  <p className="text-sm font-semibold">Arcane</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Cool teal and cyan tones channeling arcane frost magic. Inspired by WoW's mage and
                  night elf aesthetic.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

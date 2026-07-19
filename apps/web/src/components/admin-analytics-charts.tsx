import type { AdminOverviewResponse } from "@wow-dashboard/api-schema";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@wow-dashboard/ui/components/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wow-dashboard/ui/components/card";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { useId } from "react";

import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from "@/lib/format";

const numberFormatter = new Intl.NumberFormat(DISPLAY_LOCALE);
const shortDateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const longDateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const activityConfig = {
  addonIngests: { label: "Add-on Ingests", color: "var(--chart-1)" },
  newUsers: { label: "New Users", color: "var(--chart-2)" },
} satisfies ChartConfig;

const regionConfig = {
  users: { label: "Users", color: "var(--chart-1)" },
  characters: { label: "Characters", color: "var(--chart-3)" },
} satisfies ChartConfig;

const versionConfig = {
  users: { label: "Users", color: "var(--chart-2)" },
} satisfies ChartConfig;

const sessionClientLabels = {
  web: "Web Browsers",
  desktop: "Desktop App",
  unknown: "Unknown Client",
} as const;

function ActivityChart({ activity }: { activity: AdminOverviewResponse["activity"] }) {
  const gradientId = useId().replaceAll(":", "");
  const data = activity.map((point) => {
    const date = new Date(`${point.date}T00:00:00.000Z`);
    return {
      ...point,
      dateLabel: shortDateFormatter.format(date),
      tooltipLabel: longDateFormatter.format(date),
    };
  });

  return (
    <ChartContainer
      config={activityConfig}
      initialDimension={{ width: 900, height: 300 }}
      className="h-[19rem] w-full"
      role="img"
      aria-label="Daily new users and successful add-on ingests over the last 30 days"
    >
      <ComposedChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-addonIngests)" stopOpacity={0.34} />
            <stop offset="65%" stopColor="var(--color-addonIngests)" stopOpacity={0.08} />
            <stop offset="100%" stopColor="var(--color-addonIngests)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 6" />
        <XAxis
          dataKey="dateLabel"
          axisLine={false}
          tickLine={false}
          tickMargin={10}
          minTickGap={34}
          interval="preserveStartEnd"
        />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tickMargin={8} width={36} />
        <ChartTooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 5", opacity: 0.45 }}
          content={
            <ChartTooltipContent
              indicator="dot"
              valueFormatter={(value) => numberFormatter.format(value)}
              labelFormatter={(_label, payload) => {
                const datum = payload[0]?.payload as { tooltipLabel?: unknown } | undefined;
                return typeof datum?.tooltipLabel === "string" ? datum.tooltipLabel : "";
              }}
            />
          }
        />
        <ChartLegend
          align="left"
          verticalAlign="top"
          content={<ChartLegendContent className="justify-start" />}
        />
        <Area
          dataKey="addonIngests"
          type="monotone"
          fill={`url(#${gradientId})`}
          stroke="none"
          isAnimationActive={false}
          legendType="none"
          tooltipType="none"
        />
        <Line
          dataKey="addonIngests"
          type="monotone"
          stroke="var(--color-addonIngests)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
        />
        <Bar
          dataKey="newUsers"
          fill="var(--color-newUsers)"
          radius={[3, 3, 0, 0]}
          maxBarSize={14}
          opacity={0.72}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function RegionChart({ regions }: { regions: AdminOverviewResponse["regions"] }) {
  const data = regions.map((region) => ({
    ...region,
    label: region.region.toLocaleUpperCase("en-US"),
  }));

  return (
    <ChartContainer
      config={regionConfig}
      initialDimension={{ width: 520, height: 300 }}
      className="h-[19rem] w-full"
      role="img"
      aria-label="Users and tracked characters by World of Warcraft region"
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
      >
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="2 6" />
        <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          width={32}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.45 }}
          content={
            <ChartTooltipContent
              indicator="dot"
              valueFormatter={(value) => numberFormatter.format(value)}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="users"
          fill="var(--color-users)"
          radius={[0, 3, 3, 0]}
          maxBarSize={16}
          isAnimationActive={false}
        />
        <Bar
          dataKey="characters"
          fill="var(--color-characters)"
          radius={[0, 3, 3, 0]}
          maxBarSize={16}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

function VersionChart({ versions }: { versions: AdminOverviewResponse["addonVersions"] }) {
  if (versions.length === 0) {
    return (
      <div className="flex min-h-[19rem] items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Add-on version metadata will appear after the first client snapshot is uploaded.
      </div>
    );
  }

  return (
    <ChartContainer
      config={versionConfig}
      initialDimension={{ width: 620, height: 300 }}
      className="h-[19rem] w-full"
      role="img"
      aria-label="Latest reported add-on version by user"
    >
      <BarChart
        accessibilityLayer
        data={versions}
        layout="vertical"
        margin={{ top: 8, right: 18, bottom: 4, left: 4 }}
      >
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="2 6" />
        <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="version"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          width={84}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.45 }}
          content={
            <ChartTooltipContent
              hideLabel
              indicator="line"
              valueFormatter={(value) => numberFormatter.format(value)}
            />
          }
        />
        <Bar
          dataKey="users"
          fill="var(--color-users)"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

export default function AdminAnalyticsCharts({ overview }: { overview: AdminOverviewResponse }) {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-12">
      <Card className="analytics-panel min-w-0 xl:col-span-8">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="text-base">
            <h2>Account &amp; Add-on Activity</h2>
          </CardTitle>
          <CardDescription>
            Successful uploads and new accounts during the last {overview.windowDays} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <ActivityChart activity={overview.activity} />
        </CardContent>
      </Card>

      <Card className="analytics-panel min-w-0 xl:col-span-4">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="text-base">
            <h2>WoW Regions</h2>
          </CardTitle>
          <CardDescription>
            Game regions, not physical location. A user can appear in more than one region.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <RegionChart regions={overview.regions} />
        </CardContent>
      </Card>

      <Card className="analytics-panel min-w-0 xl:col-span-6">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="text-base">
            <h2>Add-on Version Adoption</h2>
          </CardTitle>
          <CardDescription>The latest version reported by each uploading user.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <VersionChart versions={overview.addonVersions} />
        </CardContent>
      </Card>

      <Card className="analytics-panel min-w-0 xl:col-span-6">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="text-base">
            <h2>Authenticated Clients</h2>
          </CardTitle>
          <CardDescription>
            Currently valid sessions. This is an access signal, not website traffic analytics.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-[19rem] flex-col justify-center gap-3 pt-5">
          {overview.sessionClients.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No active authenticated sessions were returned.
            </p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {overview.sessionClients.map((client) => (
                <div
                  key={client.client}
                  className="rounded-lg border border-border/70 bg-muted/20 p-4"
                >
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {sessionClientLabels[client.client]}
                  </dt>
                  <dd className="mt-3 font-mono text-3xl font-semibold tabular-nums">
                    {numberFormatter.format(client.sessions)}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {numberFormatter.format(client.users)} unique user
                    {client.users === 1 ? "" : "s"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

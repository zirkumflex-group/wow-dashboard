import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@wow-dashboard/ui/components/chart";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  buildTimelineData,
  getCompareStatOption,
  type CharacterTimeline,
  type CompareStatKey,
  type CompareTimeFrame,
} from "@/lib/compare";
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from "@/lib/format";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatDateShort(takenAtSeconds: number) {
  return new Date(takenAtSeconds * 1000).toLocaleDateString(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
}

export function CompareChart({
  characterTimelines,
  nowSeconds,
  stat,
  timeFrame,
}: {
  characterTimelines: CharacterTimeline[];
  nowSeconds: number;
  stat: CompareStatKey;
  timeFrame: CompareTimeFrame;
}) {
  const statOption = getCompareStatOption(stat);
  const data = useMemo(
    () => buildTimelineData(characterTimelines, stat, timeFrame, nowSeconds),
    [characterTimelines, nowSeconds, stat, timeFrame],
  );
  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        characterTimelines.map((timeline, index) => [
          timeline.key,
          { label: timeline.name, color: CHART_COLORS[index % CHART_COLORS.length] },
        ]),
      ),
    [characterTimelines],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
        No data in selected range.
      </div>
    );
  }

  const keys = characterTimelines.map((timeline) => timeline.key);
  const numericValues = data
    .flatMap((row) => keys.map((key) => row[key]))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 1;
  const range = maxValue - minValue;
  const padding = range > 0 ? range * 0.1 : Math.max(1, Math.abs(maxValue) * 0.05);
  const yDomain: [number, number] = [Math.floor(minValue - padding), Math.ceil(maxValue + padding)];
  const xAxisInterval = data.length > 12 ? Math.ceil(data.length / 12) - 1 : 0;

  return (
    <ChartContainer
      config={config}
      className="h-[320px] w-full"
      role="img"
      aria-label={`${statOption.label} comparison for ${characterTimelines.map((item) => item.name).join(", ")}`}
    >
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.14} />
        <XAxis
          dataKey="date"
          type="category"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fontSize: 10 }}
          interval={xAxisInterval}
          tickFormatter={(timestamp: number) => formatDateShort(timestamp)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: 10 }}
          width={56}
          domain={yDomain}
          tickFormatter={statOption.format}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) =>
                new Date((value as number) * 1000).toLocaleDateString(DISPLAY_LOCALE, {
                  timeZone: DISPLAY_TIME_ZONE,
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              }
              valueFormatter={statOption.format}
              indicator="dot"
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {characterTimelines.map((timeline, index) => (
          <Line
            key={timeline.key}
            type="monotone"
            dataKey={timeline.key}
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@wow-dashboard/ui/components/chart";
import { cn } from "@wow-dashboard/ui/lib/utils";
import { Fragment, useId } from "react";
import type { DotProps } from "recharts";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

export type CharacterTrendDatum = {
  dateLabel: string;
  tooltipLabel: string;
  [key: string]: number | string | undefined;
};

export type CharacterTrendSeries = {
  key: string;
  primary?: boolean;
  secondary?: boolean;
};

type TrendEndDotProps = DotProps & {
  color: string;
  index?: number;
  lastIndex: number;
  primary: boolean;
  secondary: boolean;
};

function TrendEndDot({ color, cx, cy, index, lastIndex, primary, secondary }: TrendEndDotProps) {
  if (index !== lastIndex || typeof cx !== "number" || typeof cy !== "number") {
    return <g />;
  }

  return (
    <g aria-hidden="true" focusable="false">
      {primary ? (
        <circle
          cx={cx}
          cy={cy}
          r={7}
          fill={color}
          fillOpacity={0.12}
          stroke={color}
          strokeOpacity={0.24}
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={secondary ? 2.25 : 3.25}
        fill={color}
        stroke="var(--card)"
        strokeWidth={secondary ? 1.5 : 2}
      />
    </g>
  );
}

export function CharacterTrendChart({
  data,
  series,
  config,
  yDomain,
  yAxisWidth,
  yTickCount = 5,
  valueFormatter,
  showLegend = false,
  ariaLabel,
  className,
}: {
  data: CharacterTrendDatum[];
  series: CharacterTrendSeries[];
  config: ChartConfig;
  yDomain: [number, number];
  yAxisWidth: number;
  yTickCount?: number;
  valueFormatter?: (value: number) => string;
  showLegend?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const chartId = useId().replace(/:/g, "");

  return (
    <ChartContainer
      config={config}
      initialDimension={{ width: 720, height: 220 }}
      className={cn("aspect-auto min-h-40 w-full", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <ComposedChart
        accessibilityLayer
        data={data}
        margin={{
          top: showLegend ? 4 : 12,
          right: 14,
          bottom: 4,
          left: 2,
        }}
      >
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="2 6"
          strokeOpacity={0.46}
        />
        <XAxis
          dataKey="dateLabel"
          axisLine={false}
          tickLine={false}
          tickMargin={10}
          minTickGap={38}
          interval="preserveStartEnd"
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          width={yAxisWidth}
          domain={yDomain}
          tickCount={yTickCount}
          tickFormatter={(value: number) =>
            valueFormatter?.(value) ?? value.toLocaleString("en-US")
          }
        />
        <ChartTooltip
          cursor={{
            stroke: "var(--muted-foreground)",
            strokeDasharray: "3 5",
            strokeOpacity: 0.45,
            strokeWidth: 1,
          }}
          content={
            <ChartTooltipContent
              className="analytics-chart-tooltip"
              indicator="dot"
              valueFormatter={valueFormatter}
              labelFormatter={(label, payload) => {
                const datum = payload[0]?.payload as { tooltipLabel?: unknown } | undefined;
                return typeof datum?.tooltipLabel === "string" ? datum.tooltipLabel : label;
              }}
            />
          }
        />
        {showLegend ? (
          <ChartLegend
            align="left"
            verticalAlign="top"
            content={
              <ChartLegendContent className="analytics-chart-legend flex-wrap justify-start gap-x-4 gap-y-1 pb-3 pt-0" />
            }
          />
        ) : null}
        <defs>
          {series.map(({ key, primary }) => {
            if (!primary) return null;
            const color = `var(--color-${key})`;
            return (
              <linearGradient key={key} id={`${chartId}-${key}-area`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="58%" stopColor={color} stopOpacity={0.09} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        {series.map(({ key, primary }) =>
          primary ? (
            <Area
              key={`${key}-area`}
              dataKey={key}
              type="linear"
              baseValue={yDomain[0]}
              fill={`url(#${chartId}-${key}-area)`}
              stroke="none"
              dot={false}
              activeDot={false}
              connectNulls
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          ) : null,
        )}
        {series.map(({ key, primary, secondary }) => {
          const color = `var(--color-${key})`;
          return (
            <Fragment key={key}>
              {!secondary ? (
                <Line
                  dataKey={key}
                  type="linear"
                  stroke={color}
                  strokeWidth={primary ? 8 : 5}
                  strokeOpacity={primary ? 0.13 : 0.08}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={false}
                  connectNulls
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={false}
                />
              ) : null}
              <Line
                dataKey={key}
                name={key}
                type="linear"
                stroke={color}
                strokeWidth={secondary ? 1.5 : primary ? 2.75 : 2.1}
                strokeOpacity={secondary ? 0.48 : primary ? 1 : 0.86}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={
                  <TrendEndDot
                    color={color}
                    lastIndex={data.length - 1}
                    primary={primary ?? false}
                    secondary={secondary ?? false}
                  />
                }
                activeDot={{
                  r: secondary ? 3 : 4.5,
                  fill: "var(--card)",
                  stroke: color,
                  strokeWidth: 2.5,
                }}
                connectNulls
                isAnimationActive={false}
              />
            </Fragment>
          );
        })}
      </ComposedChart>
    </ChartContainer>
  );
}

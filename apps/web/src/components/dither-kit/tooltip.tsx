"use client";

import { useState } from "react";
import { useCommonChart } from "./common-context";
import { cn } from "./lib";
import { rgb } from "./palette";

export type TooltipVariant = "default" | "frosted-glass";

const VARIANT: Record<TooltipVariant, string> = {
  default: "bg-popover",
  "frosted-glass": "bg-popover/70 backdrop-blur-sm",
};

/**
 * Floating hover tooltip. Reads the shared common context so it works in every
 * chart family. It glides between points and fades in/out (instead of snapping),
 * and dims unselected series/slices.
 */
export function Tooltip({
  labelKey,
  valueFormatter,
  variant = "default",
}: {
  labelKey?: string;
  valueFormatter?: (value: number, name: string) => string;
  variant?: TooltipVariant;
}) {
  const chart = useCommonChart();
  const show = chart.ready && chart.hoverIndex != null;

  // Retain the last hovered index so the card keeps its content while fading
  // out — adjust-state-during-render (no refs in render).
  const [lastIndex, setLastIndex] = useState(0);
  if (chart.hoverIndex != null && chart.hoverIndex !== lastIndex) {
    setLastIndex(chart.hoverIndex);
  }
  const index = chart.hoverIndex ?? lastIndex;

  const heading = chart.heading(index, labelKey);
  const items = chart.itemsAt(index);

  if (items.length === 0) return null;

  return (
    <div
      aria-hidden={!show}
      style={{
        opacity: show ? 1 : 0,
        transform: "translate(-50%, -115%)",
        top: chart.tooltipTop,
        left: chart.tooltipLeft,
      }}
      className={cn(
        "pointer-events-none absolute z-10 rounded-md border px-2 py-1 shadow-sm duration-150 ease-out motion-safe:transition-[opacity,transform,left,top] motion-reduce:transition-none",
        VARIANT[variant],
      )}
    >
      {heading && (
        <div className="mb-0.5 font-mono text-[10px] text-muted-foreground">{heading}</div>
      )}
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-1.5 font-mono text-[11px] text-popover-foreground tabular-nums"
            style={{ opacity: item.dimmed ? 0.4 : 1 }}
          >
            <span
              className="size-2 rounded-[1px]"
              style={{ backgroundColor: rgb(item.seed.fill) }}
            />
            <span className="text-muted-foreground">{item.label}</span>
            <span className="ml-auto pl-2 text-foreground">
              {valueFormatter
                ? valueFormatter(item.value, item.name)
                : item.value.toLocaleString("en-US")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

Tooltip.chartLayer = "dom" as const;

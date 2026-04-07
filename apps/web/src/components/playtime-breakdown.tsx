import { cn } from "@wow-dashboard/ui/lib/utils";

export function formatPlaytime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

type PlaytimeBreakdownProps = {
  totalSeconds: number;
  thisLevelSeconds?: number;
  variant?: "compact" | "default" | "hero";
  align?: "start" | "center" | "end";
  className?: string;
};

export function PlaytimeBreakdown({
  totalSeconds,
  thisLevelSeconds,
  variant = "default",
  align = "start",
  className,
}: PlaytimeBreakdownProps) {
  const totalValue = formatPlaytime(totalSeconds);
  const levelValue = thisLevelSeconds === undefined ? "--" : formatPlaytime(thisLevelSeconds);

  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex max-w-full flex-wrap items-center gap-1.5",
          align === "center" && "justify-center",
          align === "end" && "justify-end",
          className,
        )}
      >
        <span className="tabular-nums text-sm font-semibold leading-none text-foreground">
          {totalValue}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-muted/20 px-1.5 py-0.5">
          <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/80">
            Lvl
          </span>
          <span className="tabular-nums text-[10px] font-medium leading-none text-muted-foreground">
            {levelValue}
          </span>
        </span>
      </span>
    );
  }

  if (variant === "default") {
    return (
      <div className={cn("flex max-w-full items-center justify-between gap-3", className)}>
        <span
          className={cn(
            "min-w-0 tabular-nums text-sm font-semibold leading-tight text-foreground",
            align === "center" && "text-center",
            align === "end" && "text-right",
          )}
        >
          {totalValue}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-baseline gap-2 border-l border-border/50 pl-3",
            align === "center" && "justify-center text-center",
            align === "end" && "justify-end text-right",
          )}
        >
          <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/75">
            This level
          </span>
          <span className="tabular-nums text-sm font-semibold leading-tight text-foreground">
            {levelValue}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid max-w-full grid-cols-[minmax(0,1fr)_auto] items-stretch",
        "inline-grid gap-4",
        className,
      )}
    >
      <span
        className={cn(
          "flex min-w-0 items-center",
          align === "center" && "text-center",
          align === "end" && "text-right",
        )}
      >
        <span
          className={cn(
            "tabular-nums text-4xl font-bold leading-none text-foreground",
          )}
        >
          {totalValue}
        </span>
      </span>
      <span
        className={cn(
          "flex shrink-0 self-stretch flex-col justify-center border-l border-border/50",
          align === "center" && "items-center text-center",
          align === "end" && "items-end text-right",
          align === "start" && "items-start text-left",
          "min-w-[8rem] gap-1 pl-4",
        )}
      >
        <span
          className={cn(
            "text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75",
          )}
        >
          This level
        </span>
        <span
          className={cn(
            "tabular-nums text-lg font-semibold leading-none",
          )}
        >
          {levelValue}
        </span>
      </span>
    </div>
  );
}

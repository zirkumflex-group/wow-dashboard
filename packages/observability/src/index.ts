export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function errorToJson(error: Error) {
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.cause !== undefined ? { cause: error.cause } : {}),
  };
}

function stringifyLogEntry(entry: LogContext): string {
  try {
    return JSON.stringify(entry, (_key, value: unknown) => {
      if (value instanceof Error) return errorToJson(value);
      if (typeof value === "bigint") return value.toString();
      return value;
    });
  } catch (error) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: entry.service ?? "unknown",
      event: "log.serialization_failed",
      error: error instanceof Error ? errorToJson(error) : String(error),
    });
  }
}

export function createLogger(service: string, minimumLevel: LogLevel = "info") {
  const write = (level: LogLevel, event: string, context: LogContext = {}) => {
    if (levelRank[level] < levelRank[minimumLevel]) return;

    const line = stringifyLogEntry({
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...context,
    });

    if (level === "warn" || level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  };

  return {
    debug: (event: string, context?: LogContext) => write("debug", event, context),
    info: (event: string, context?: LogContext) => write("info", event, context),
    warn: (event: string, context?: LogContext) => write("warn", event, context),
    error: (event: string, context?: LogContext) => write("error", event, context),
  };
}

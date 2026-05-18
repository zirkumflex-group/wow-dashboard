export type DesktopAuthSessionState =
  | {
      status: "valid";
      session: unknown;
    }
  | {
      status: "unauthenticated";
    }
  | {
      status: "unknown";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveDesktopAuthSessionState(payload: unknown): DesktopAuthSessionState {
  if (payload === null || payload === undefined) {
    return {
      status: "unauthenticated",
    };
  }

  if (!isRecord(payload)) {
    return {
      status: "unknown",
    };
  }

  const session = payload["session"];
  const user = payload["user"];

  if (session === null || session === undefined || user === null || user === undefined) {
    return {
      status: "unauthenticated",
    };
  }

  if (!isRecord(session) || !isRecord(user)) {
    return {
      status: "unknown",
    };
  }

  return {
    status: "valid",
    session: payload,
  };
}

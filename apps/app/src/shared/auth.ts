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

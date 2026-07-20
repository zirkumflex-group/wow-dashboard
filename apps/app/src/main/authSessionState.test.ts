import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDesktopAuthSessionState } from "../shared/auth";

describe("desktop auth session validation", () => {
  it("distinguishes an explicit signed-out response from a transient malformed response", () => {
    assert.deepEqual(resolveDesktopAuthSessionState(null), { status: "unauthenticated" });
    assert.deepEqual(resolveDesktopAuthSessionState({ session: null, user: null }), {
      status: "unauthenticated",
    });
    assert.deepEqual(resolveDesktopAuthSessionState("upstream error"), { status: "unknown" });
    assert.deepEqual(resolveDesktopAuthSessionState({ session: {}, user: null }), {
      status: "unauthenticated",
    });
  });

  it("accepts only object-shaped session and user records", () => {
    const payload = {
      session: { id: "session-id" },
      user: { id: "user-id" },
    };
    assert.deepEqual(resolveDesktopAuthSessionState(payload), {
      status: "valid",
      session: payload,
    });
    assert.deepEqual(resolveDesktopAuthSessionState({ session: "bad", user: {} }), {
      status: "unknown",
    });
  });
});

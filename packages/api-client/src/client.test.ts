import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./client";

describe("API client transport", () => {
  it("applies a deadline to every request", async () => {
    const client = createApiClient({
      baseUrl: "https://dashboard.example/api",
      requestTimeoutMs: 10,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          assert.ok(signal);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });

    await assert.rejects(
      client.getMe(),
      (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
    );
  });

  it("scopes bearer credentials to the configured API base URL", async () => {
    let request: { url: string; authorization: string | null } | null = null;
    const client = createApiClient({
      baseUrl: "https://dashboard.example/api",
      getAccessToken: () => "session-token",
      fetch: async (input, init) => {
        request = {
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        };
        return Response.json({
          session: {
            id: "session-id",
            userId: "user-id",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-02-01T00:00:00.000Z",
          },
          user: {
            id: "user-id",
            name: "User",
            email: "user@example.com",
            emailVerified: true,
            image: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          player: null,
        });
      },
    });

    await client.getMe();
    assert.deepEqual(request, {
      url: "https://dashboard.example/api/me",
      authorization: "Bearer session-token",
    });
  });

  it("requests the lightweight authenticated character count", async () => {
    let requestedUrl = "";
    const client = createApiClient({
      baseUrl: "https://dashboard.example/api",
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json({ count: 3 });
      },
    });

    assert.deepEqual(await client.getMyCharacterCount(), { count: 3 });
    assert.equal(requestedUrl, "https://dashboard.example/api/characters/count");
  });
});

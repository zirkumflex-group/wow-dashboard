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
            role: "user",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          isAdmin: false,
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

  it("exposes response headers before parsing for server-side cookie forwarding", async () => {
    let forwardedCookie = "";
    const client = createApiClient({
      baseUrl: "https://dashboard.example/api",
      onResponse: (response) => {
        forwardedCookie = response.headers.get("set-cookie") ?? "";
      },
      fetch: async () =>
        Response.json(
          {
            count: 3,
          },
          {
            headers: {
              "set-cookie": "better-auth.session_token=refreshed; HttpOnly; Max-Age=15552000",
            },
          },
        ),
    });

    await client.getMyCharacterCount();
    assert.match(forwardedCookie, /better-auth\.session_token=refreshed/);
  });

  it("serializes administrator directory pagination", async () => {
    let requestedUrl = "";
    const client = createApiClient({
      baseUrl: "https://dashboard.example/api",
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json({
          users: [],
          total: 0,
          page: 2,
          pageSize: 20,
          totalPages: 1,
        });
      },
    });

    await client.getAdminUsers({ page: 2, pageSize: 20 });
    assert.equal(requestedUrl, "https://dashboard.example/api/admin/users?page=2&pageSize=20");
  });
});

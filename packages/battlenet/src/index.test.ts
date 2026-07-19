import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient } from "@wow-dashboard/db";
import {
  BattleNetRequestError,
  createBattleNetTokenService,
  fetchBattleNetCharactersForRegion,
} from "./index";

function accountRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "account-row-id",
    accountId: "battle-account-id",
    providerId: "battlenet",
    userId: "user-id",
    accessToken: "current-access-token",
    refreshToken: "current-refresh-token",
    idToken: null,
    accessTokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    refreshTokenExpiresAt: null,
    scope: "openid wow.profile",
    password: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function databaseMock(row: ReturnType<typeof accountRow>, onUpdate?: (value: unknown) => void) {
  return {
    query: {
      account: {
        findFirst: async () => row,
      },
    },
    update: () => ({
      set: (value: unknown) => ({
        where: async () => {
          onUpdate?.(value);
        },
      }),
    }),
  } as unknown as DatabaseClient;
}

describe("Battle.net token service", () => {
  it("returns a fresh database token without making a network request", async () => {
    let fetchCalls = 0;
    const service = createBattleNetTokenService({
      db: databaseMock(accountRow()),
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("fetch should not be called");
      },
    });

    assert.deepEqual(await service.resolveForUser("user-id"), {
      ok: true,
      accessToken: "current-access-token",
      refreshed: false,
    });
    assert.equal(fetchCalls, 0);
  });

  it("persists a refreshed token and does not fail the job when audit storage is unavailable", async () => {
    const persistedValues: Record<string, unknown>[] = [];
    let auditFailures = 0;
    const service = createBattleNetTokenService({
      db: databaseMock(
        accountRow({ accessTokenExpiresAt: new Date(Date.now() - 1_000) }),
        (value) => {
          persistedValues.push(value as Record<string, unknown>);
        },
      ),
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            refresh_token: "rotated-refresh-token",
            expires_in: 7_200,
          }),
          { status: 200 },
        ),
      audit: async () => {
        throw new Error("audit database unavailable");
      },
      onAuditError: () => {
        auditFailures += 1;
      },
    });

    assert.deepEqual(await service.resolveForUser("user-id"), {
      ok: true,
      accessToken: "refreshed-access-token",
      refreshed: true,
    });
    const persisted = persistedValues[0];
    assert.ok(persisted);
    assert.equal(persisted.accessToken, "refreshed-access-token");
    assert.equal(persisted.refreshToken, "rotated-refresh-token");
    assert.ok(persisted.accessTokenExpiresAt instanceof Date);
    assert.equal(auditFailures, 1);
  });
});

describe("Battle.net profile requests", () => {
  it("flattens characters across WoW accounts and treats a missing regional profile as empty", async () => {
    const characters = await fetchBattleNetCharactersForRegion("token", "eu", {
      fetch: async () =>
        Response.json({
          wow_accounts: [
            {
              characters: [
                {
                  name: "Example",
                  realm: { name: "Draenor", slug: "draenor" },
                  playable_class: { name: "Mage" },
                  playable_race: { name: "Human" },
                  faction: { type: "ALLIANCE" },
                  level: 80,
                },
              ],
            },
          ],
        }),
    });
    assert.equal(characters.length, 1);
    assert.equal(characters[0]?.name, "Example");

    const missing = await fetchBattleNetCharactersForRegion("token", "kr", {
      fetch: async () => new Response(null, { status: 404 }),
    });
    assert.deepEqual(missing, []);
  });

  it("classifies transient and permanent provider failures for queue retry policy", async () => {
    await assert.rejects(
      fetchBattleNetCharactersForRegion("token", "us", {
        fetch: async () => new Response(null, { status: 429 }),
      }),
      (error: unknown) =>
        error instanceof BattleNetRequestError && error.retryable && error.status === 429,
    );

    await assert.rejects(
      fetchBattleNetCharactersForRegion("token", "tw", {
        fetch: async () => new Response(null, { status: 401 }),
      }),
      (error: unknown) =>
        error instanceof BattleNetRequestError && !error.retryable && error.status === 401,
    );
  });
});

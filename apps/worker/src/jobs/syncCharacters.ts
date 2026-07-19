import { and, eq, sql } from "drizzle-orm";
import {
  battleNetRegions,
  fetchBattleNetCharactersForRegion,
  type BattleNetCharacter,
  type BattleNetRegion,
} from "@wow-dashboard/battlenet";
import { characters, players } from "@wow-dashboard/db";
import type { SyncCharactersJobPayload } from "@wow-dashboard/api-schema";
import { resolveBattleNetAccessTokenForUser } from "../battleNetTokens";
import { db } from "../db";

type NormalizedBattleNetCharacter = {
  name: string;
  realm: string;
  realmSlug: string | null;
  class: string;
  race: string;
  faction: "alliance" | "horde";
  level: number;
};

function battleNetVerificationFields(
  character: NormalizedBattleNetCharacter,
  region: BattleNetRegion,
  verifiedAt: Date,
) {
  return {
    name: character.name,
    realm: character.realm,
    region,
    class: character.class,
    race: character.race,
    faction: character.faction,
    battleNetVerificationStatus: "verified" as const,
    battleNetVerifiedAt: verifiedAt,
    battleNetLastCheckedAt: verifiedAt,
    battleNetRealmSlug: character.realmSlug,
    battleNetLevel: character.level,
    battleNetVerificationError: null,
  };
}

function normalizeBattleNetCharacter(
  character: BattleNetCharacter,
): NormalizedBattleNetCharacter | null {
  if (character.level < 10) return null;

  const faction = character.faction.type.trim().toLowerCase();
  if (faction !== "alliance" && faction !== "horde") {
    return null;
  }

  return {
    name: character.name,
    realm: character.realm.name,
    realmSlug: character.realm.slug || null,
    class: character.playable_class.name,
    race: character.playable_race.name,
    faction,
    level: character.level,
  };
}

function characterNaturalKey(character: { name: string; realm: string }): string {
  return `${character.realm.toLocaleLowerCase("en-US")}\u0000${character.name.toLocaleLowerCase(
    "en-US",
  )}`;
}

export async function syncCharacters(
  payload: SyncCharactersJobPayload,
  options: { signal?: AbortSignal } = {},
) {
  const player = await db.query.players.findFirst({
    where: eq(players.userId, payload.userId),
  });

  if (!player) {
    return {
      inserted: 0,
      updated: 0,
      scanned: 0,
      skipped: true,
      skipReason: "missing_player" as const,
      tokenRefreshed: false,
    };
  }

  const token = await resolveBattleNetAccessTokenForUser(payload.userId, options.signal);
  if (!token.ok) {
    if (token.reason === "refresh_failed") {
      throw new Error("Battle.net access token refresh failed");
    }

    return {
      inserted: 0,
      updated: 0,
      scanned: 0,
      skipped: true,
      skipReason: token.reason,
      tokenRefreshed: false,
    };
  }

  const results = await Promise.all(
    battleNetRegions.map(async (region) => ({
      region,
      characters: await fetchBattleNetCharactersForRegion(token.accessToken, region, {
        signal: options.signal,
      }),
    })),
  );

  let inserted = 0;
  let updated = 0;
  let scanned = 0;

  for (const result of results) {
    const normalizedByNaturalKey = new Map<string, NormalizedBattleNetCharacter>();
    for (const character of result.characters) {
      const normalized = normalizeBattleNetCharacter(character);
      if (!normalized) continue;
      scanned += 1;
      normalizedByNaturalKey.set(characterNaturalKey(normalized), normalized);
    }
    const normalizedCharacters = Array.from(normalizedByNaturalKey.values());

    if (normalizedCharacters.length === 0) continue;

    const existingCharacters = await db.query.characters.findMany({
      columns: {
        normalizedRealm: true,
        normalizedName: true,
      },
      where: and(eq(characters.playerId, player.id), eq(characters.region, result.region)),
    });
    const existingNaturalKeys = new Set(
      existingCharacters.map(
        (character) => `${character.normalizedRealm}\u0000${character.normalizedName}`,
      ),
    );

    for (const character of normalizedCharacters) {
      if (existingNaturalKeys.has(characterNaturalKey(character))) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    const verifiedAt = new Date();
    await db
      .insert(characters)
      .values(
        normalizedCharacters.map((character) => ({
          playerId: player.id,
          ...battleNetVerificationFields(character, result.region, verifiedAt),
        })),
      )
      .onConflictDoUpdate({
        target: [
          characters.playerId,
          characters.region,
          characters.normalizedRealm,
          characters.normalizedName,
        ],
        set: {
          name: sql`excluded."name"`,
          realm: sql`excluded."realm"`,
          class: sql`excluded."class"`,
          race: sql`excluded."race"`,
          faction: sql`excluded."faction"`,
          battleNetVerificationStatus: "verified",
          battleNetVerifiedAt: verifiedAt,
          battleNetLastCheckedAt: verifiedAt,
          battleNetRealmSlug: sql`excluded."battle_net_realm_slug"`,
          battleNetLevel: sql`excluded."battle_net_level"`,
          battleNetVerificationError: null,
        },
      });
  }

  return {
    inserted,
    updated,
    scanned,
    skipped: false,
    skipReason: null,
    tokenRefreshed: token.refreshed,
  };
}

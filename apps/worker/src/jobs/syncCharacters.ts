import { and, eq, sql } from "drizzle-orm";
import { characters, players } from "@wow-dashboard/db";
import type { SyncCharactersJobPayload } from "@wow-dashboard/api-schema";
import { db } from "../db";

interface BattleNetWowAccount {
  characters?: BattleNetCharacter[];
}

interface BattleNetCharacter {
  name: string;
  realm: { name: string; slug: string };
  playable_class: { name: string };
  playable_race: { name: string };
  faction: { type: string };
  level: number;
}

interface BattleNetWowProfileResponse {
  wow_accounts?: BattleNetWowAccount[];
}

const battleNetRegions = ["us", "eu", "kr", "tw"] as const;
type BattleNetRegion = (typeof battleNetRegions)[number];

async function fetchCharactersForRegion(
  accessToken: string,
  region: BattleNetRegion,
): Promise<{ region: BattleNetRegion; characters: BattleNetCharacter[] } | null> {
  try {
    const url = `https://${region}.api.blizzard.com/profile/user/wow?namespace=profile-${region}&locale=en_US`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status !== 404) {
        console.error(
          `[worker] Battle.net WoW profile API error for region ${region}: ${response.status} ${response.statusText}`,
        );
      }

      return null;
    }

    const data = (await response.json()) as BattleNetWowProfileResponse;
    return {
      region,
      characters: (data.wow_accounts ?? []).flatMap((account) => account.characters ?? []),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[worker] Battle.net WoW profile request failed for region ${region}: ${message}`,
    );
    return null;
  }
}

export async function syncCharacters(payload: SyncCharactersJobPayload) {
  const player = await db.query.players.findFirst({
    where: eq(players.userId, payload.userId),
  });

  if (!player) {
    console.warn(`[worker] syncCharacters skipped: no player bound to user ${payload.userId}`);
    return {
      inserted: 0,
      updated: 0,
      scanned: 0,
      skipped: true,
    };
  }

  const results = await Promise.all(
    battleNetRegions.map((region) => fetchCharactersForRegion(payload.accessToken, region)),
  );

  let inserted = 0;
  let updated = 0;
  let scanned = 0;

  for (const result of results) {
    if (!result || result.characters.length === 0) continue;

    const filteredCharacters = result.characters
      .filter((character) => character.level >= 10)
      .map((character) => ({
        name: character.name,
        realm: character.realm.name,
        class: character.playable_class.name,
        race: character.playable_race.name,
        faction: character.faction.type.toLowerCase() as "alliance" | "horde",
      }));

    scanned += filteredCharacters.length;

    for (const character of filteredCharacters) {
      const existingCharacter = await db.query.characters.findFirst({
        where: and(
          eq(characters.playerId, player.id),
          eq(characters.region, result.region),
          sql`${characters.normalizedRealm} = lower(${character.realm})`,
          sql`${characters.normalizedName} = lower(${character.name})`,
        ),
      });

      if (!existingCharacter) {
        await db
          .insert(characters)
          .values({
            playerId: player.id,
            name: character.name,
            realm: character.realm,
            region: result.region,
            class: character.class,
            race: character.race,
            faction: character.faction,
          })
          .onConflictDoUpdate({
            target: [
              characters.playerId,
              characters.region,
              characters.normalizedRealm,
              characters.normalizedName,
            ],
            set: {
              name: character.name,
              realm: character.realm,
              class: character.class,
              race: character.race,
              faction: character.faction,
            },
          });
        inserted += 1;
        continue;
      }

      await db
        .update(characters)
        .set({
          name: character.name,
          realm: character.realm,
          class: character.class,
          race: character.race,
          faction: character.faction,
        })
        .where(eq(characters.id, existingCharacter.id));
      updated += 1;
    }
  }

  return {
    inserted,
    updated,
    scanned,
    skipped: false,
  };
}

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

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

const REGIONS = ["us", "eu", "kr", "tw"] as const;
type Region = (typeof REGIONS)[number];

async function fetchCharactersForRegion(
  accessToken: string,
  region: Region,
): Promise<{ region: Region; characters: BattleNetCharacter[] } | null> {
  const url = `https://${region}.api.blizzard.com/profile/user/wow?namespace=profile-${region}&locale=en_US`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    if (resp.status !== 404) {
      console.error(
        `Battle.net WoW profile API error for region ${region}: ${resp.status} ${resp.statusText}`,
      );
    }
    return null;
  }

  const data = (await resp.json()) as BattleNetWowProfileResponse;
  const characters = (data.wow_accounts ?? []).flatMap((acct) => acct.characters ?? []);
  return { region, characters };
}

export const syncCharacters = internalAction({
  args: {
    userId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, { userId, accessToken }) => {
    const results = await Promise.all(
      REGIONS.map((region) => fetchCharactersForRegion(accessToken, region)),
    );

    for (const result of results) {
      if (!result || result.characters.length === 0) continue;

      const characters = result.characters
        .filter((c) => c.level >= 10)
        .map((c) => ({
          name: c.name,
          realm: c.realm.name,
          class: c.playable_class.name,
          race: c.playable_race.name,
          faction: c.faction.type.toLowerCase() as "alliance" | "horde",
        }));

      if (characters.length === 0) continue;

      await ctx.runMutation(internal.characters.upsertFromBattleNet, {
        userId,
        region: result.region,
        characters,
      });
    }
  },
});

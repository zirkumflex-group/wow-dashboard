import type {
  CharactersLatestQuery,
  PlayerCharactersResponse,
  PlayerScoreboardEntry,
  ScoreboardCharacterEntry,
  SerializedDashboardCharacter,
  SerializedPinnedCharacter,
  MeResponse,
  CharacterBoosterExportEntry,
} from "@wow-dashboard/api-schema";
import type { ApiClient } from "./client";

export type ApiQueryOptions<
  TData,
  TQueryKey extends readonly unknown[] = readonly unknown[],
> = {
  queryKey: TQueryKey;
  queryFn: () => Promise<TData>;
};

function normalizeCharacterIds(input: CharactersLatestQuery) {
  return Array.from(new Set<string>(input.characterId)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export const apiQueryKeys = {
  me: () => ["api", "me"] as const,
  myCharacters: () => ["api", "characters"] as const,
  charactersLatest: (input: CharactersLatestQuery) =>
    ["api", "characters", "latest", ...normalizeCharacterIds(input)] as const,
  scoreboardCharacters: () => ["api", "characters", "scoreboard"] as const,
  playerScoreboard: () => ["api", "scoreboard", "players"] as const,
  playerCharacters: (playerId: string) => ["api", "players", playerId, "characters"] as const,
  boosterCharactersForExport: () => ["api", "characters", "boosters", "export"] as const,
};

export function createApiQueryOptions(client: ApiClient) {
  return {
    me(): ApiQueryOptions<MeResponse, ReturnType<typeof apiQueryKeys.me>> {
      return {
        queryKey: apiQueryKeys.me(),
        queryFn: () => client.getMe(),
      };
    },

    myCharacters(): ApiQueryOptions<
      SerializedDashboardCharacter[] | null,
      ReturnType<typeof apiQueryKeys.myCharacters>
    > {
      return {
        queryKey: apiQueryKeys.myCharacters(),
        queryFn: () => client.getMyCharacters(),
      };
    },

    charactersLatest(
      input: CharactersLatestQuery,
    ): ApiQueryOptions<
      SerializedPinnedCharacter[],
      ReturnType<typeof apiQueryKeys.charactersLatest>
    > {
      return {
        queryKey: apiQueryKeys.charactersLatest(input),
        queryFn: () => client.getCharactersLatest(input),
      };
    },

    scoreboardCharacters(): ApiQueryOptions<
      ScoreboardCharacterEntry[],
      ReturnType<typeof apiQueryKeys.scoreboardCharacters>
    > {
      return {
        queryKey: apiQueryKeys.scoreboardCharacters(),
        queryFn: () => client.getScoreboardCharacters(),
      };
    },

    playerScoreboard(): ApiQueryOptions<
      PlayerScoreboardEntry[],
      ReturnType<typeof apiQueryKeys.playerScoreboard>
    > {
      return {
        queryKey: apiQueryKeys.playerScoreboard(),
        queryFn: () => client.getPlayerScoreboard(),
      };
    },

    playerCharacters(
      playerId: string,
    ): ApiQueryOptions<
      PlayerCharactersResponse | null,
      ReturnType<typeof apiQueryKeys.playerCharacters>
    > {
      return {
        queryKey: apiQueryKeys.playerCharacters(playerId),
        queryFn: () => client.getPlayerCharacters(playerId),
      };
    },

    boosterCharactersForExport(): ApiQueryOptions<
      CharacterBoosterExportEntry[],
      ReturnType<typeof apiQueryKeys.boosterCharactersForExport>
    > {
      return {
        queryKey: apiQueryKeys.boosterCharactersForExport(),
        queryFn: () => client.getBoosterCharactersForExport(),
      };
    },
  };
}

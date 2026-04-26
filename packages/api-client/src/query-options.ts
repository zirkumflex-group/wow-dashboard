import type {
  CharacterDetailTimelineQuery,
  CharacterDetailTimelineResponse,
  CharactersLatestQuery,
  CharacterMythicPlusQuery,
  CharacterMythicPlusResponse,
  CharacterPageQuery,
  CharacterPageResponse,
  CharacterSnapshotTimelineQuery,
  CharacterSnapshotTimelineResponse,
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
  characterPage: (characterId: string, input: CharacterPageQuery) =>
    [
      "api",
      "characters",
      characterId,
      "page",
      input.timeFrame,
      input.includeStats === true ? "stats" : "core",
    ] as const,
  characterDetailTimeline: (characterId: string, input: CharacterDetailTimelineQuery) =>
    ["api", "characters", characterId, "detail-timeline", input.timeFrame, input.metric] as const,
  characterSnapshotTimeline: (characterId: string, input: CharacterSnapshotTimelineQuery) =>
    ["api", "characters", characterId, "snapshot-timeline", input.timeFrame] as const,
  characterMythicPlus: (characterId: string, input: CharacterMythicPlusQuery) =>
    [
      "api",
      "characters",
      characterId,
      "mythic-plus",
      input.includeAllRuns === true ? "all" : "preview",
    ] as const,
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

    characterPage(
      characterId: string,
      input: CharacterPageQuery,
    ): ApiQueryOptions<
      CharacterPageResponse | null,
      ReturnType<typeof apiQueryKeys.characterPage>
    > {
      return {
        queryKey: apiQueryKeys.characterPage(characterId, input),
        queryFn: () => client.getCharacterPage(characterId, input),
      };
    },

    characterDetailTimeline(
      characterId: string,
      input: CharacterDetailTimelineQuery,
    ): ApiQueryOptions<
      CharacterDetailTimelineResponse | null,
      ReturnType<typeof apiQueryKeys.characterDetailTimeline>
    > {
      return {
        queryKey: apiQueryKeys.characterDetailTimeline(characterId, input),
        queryFn: () => client.getCharacterDetailTimeline(characterId, input),
      };
    },

    characterSnapshotTimeline(
      characterId: string,
      input: CharacterSnapshotTimelineQuery,
    ): ApiQueryOptions<
      CharacterSnapshotTimelineResponse | null,
      ReturnType<typeof apiQueryKeys.characterSnapshotTimeline>
    > {
      return {
        queryKey: apiQueryKeys.characterSnapshotTimeline(characterId, input),
        queryFn: () => client.getCharacterSnapshotTimeline(characterId, input),
      };
    },

    characterMythicPlus(
      characterId: string,
      input: CharacterMythicPlusQuery = {},
    ): ApiQueryOptions<
      CharacterMythicPlusResponse | null,
      ReturnType<typeof apiQueryKeys.characterMythicPlus>
    > {
      return {
        queryKey: apiQueryKeys.characterMythicPlus(characterId, input),
        queryFn: () => client.getCharacterMythicPlus(characterId, input),
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

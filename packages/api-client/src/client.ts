import { z } from "zod";
import {
  addonIngestBodySchema,
  addonIngestResponseSchema,
  apiErrorResponseSchema,
  boosterCharactersExportResponseSchema,
  characterDetailTimelineQuerySchema,
  characterDetailTimelineResultSchema,
  characterMythicPlusQuerySchema,
  characterMythicPlusResultSchema,
  characterPageQuerySchema,
  characterPageResultSchema,
  characterRouteParamsSchema,
  characterSnapshotTimelineQuerySchema,
  characterSnapshotTimelineResultSchema,
  charactersLatestQuerySchema,
  charactersLatestResponseSchema,
  charactersScoreboardResponseSchema,
  loginCodeResponseSchema,
  meResponseSchema,
  myCharactersResponseSchema,
  playerCharactersResultSchema,
  playerRouteParamsSchema,
  playerScoreboardResponseSchema,
  redeemLoginCodeBodySchema,
  redeemLoginCodeResponseSchema,
  resyncCharactersResponseSchema,
  updateCharacterBoosterBodySchema,
  updateCharacterBoosterResponseSchema,
  updateCharacterSlotsBodySchema,
  updateCharacterSlotsResponseSchema,
  updatePlayerDiscordBodySchema,
  updatePlayerDiscordResponseSchema,
  type AddonIngestBody,
  type AddonIngestResponse,
  type CharacterDetailTimelineQuery,
  type CharacterDetailTimelineResponse,
  type CharacterBoosterExportEntry,
  type CharacterMythicPlusQuery,
  type CharacterMythicPlusResponse,
  type CharacterPageQuery,
  type CharacterPageResponse,
  type CharacterSnapshotTimelineQuery,
  type CharacterSnapshotTimelineResponse,
  type CharactersLatestQuery,
  type LoginCodeResponse,
  type MeResponse,
  type PlayerCharactersResponse,
  type PlayerScoreboardEntry,
  type RedeemLoginCodeBody,
  type RedeemLoginCodeResponse,
  type ResyncCharactersResponse,
  type ScoreboardCharacterEntry,
  type SerializedDashboardCharacter,
  type SerializedPinnedCharacter,
  type UpdateCharacterBoosterBody,
  type UpdateCharacterBoosterResponse,
  type UpdateCharacterSlotsBody,
  type UpdateCharacterSlotsResponse,
  type UpdatePlayerDiscordBody,
  type UpdatePlayerDiscordResponse,
} from "@wow-dashboard/api-schema";

type AccessTokenResolver = () => Promise<string | null | undefined> | string | null | undefined;
type HeadersResolver = () => Promise<HeadersInit | undefined> | HeadersInit | undefined;
type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

export type ApiClientConfig = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  getAccessToken?: AccessTokenResolver;
  getHeaders?: HeadersResolver;
};

type JsonRequestOptions<TInput, TOutput> = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, QueryValue>;
  input?: TInput;
  inputSchema?: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  includeAuth?: boolean;
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown,
    readonly headers: Headers,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed === "") {
    return "/api";
  }
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function buildQueryString(query: Record<string, QueryValue> | undefined) {
  const searchParams = new URLSearchParams();
  if (!query) {
    return "";
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
      continue;
    }

    searchParams.set(key, String(value));
  }

  const encoded = searchParams.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

async function resolveHeaders(headersResolver: HeadersResolver | undefined) {
  if (!headersResolver) {
    return undefined;
  }

  return typeof headersResolver === "function" ? await headersResolver() : headersResolver;
}

async function resolveAccessToken(accessTokenResolver: AccessTokenResolver | undefined) {
  if (!accessTokenResolver) {
    return null;
  }

  const token =
    typeof accessTokenResolver === "function" ? await accessTokenResolver() : accessTokenResolver;
  return token ?? null;
}

function parseResponseBody(text: string) {
  if (text.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function truncateResponseText(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 300) {
    return trimmed;
  }
  return `${trimmed.slice(0, 300)}...`;
}

function getErrorMessageFromResponseBody(rawBody: unknown, status: number, statusText: string) {
  const parsedError = apiErrorResponseSchema.safeParse(rawBody);
  if (parsedError.success && parsedError.data.error.trim() !== "") {
    return parsedError.data.error;
  }

  if (typeof rawBody === "string" && rawBody.trim() !== "") {
    return truncateResponseText(rawBody);
  }

  const normalizedStatusText = statusText.trim();
  if (normalizedStatusText !== "") {
    return normalizedStatusText;
  }

  return `HTTP ${status}`;
}

function normalizeCharacterIds(input: CharactersLatestQuery) {
  return Array.from(new Set<string>(input.characterId)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function createApiClient(config: ApiClientConfig) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetchImpl = config.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to create the API client.");
  }

  async function requestJson<TInput, TOutput>({
    method,
    path,
    query,
    input,
    inputSchema,
    outputSchema,
    includeAuth = true,
  }: JsonRequestOptions<TInput, TOutput>): Promise<TOutput> {
    const parsedInput = inputSchema ? inputSchema.parse(input) : input;
    const headers = new Headers(await resolveHeaders(config.getHeaders));
    headers.set("accept", "application/json");

    if (includeAuth) {
      const accessToken = await resolveAccessToken(config.getAccessToken);
      if (accessToken) {
        headers.set("authorization", `Bearer ${accessToken}`);
      }
    }

    const requestInit: RequestInit = {
      method,
      headers,
      credentials: config.credentials ?? "include",
    };

    if (parsedInput !== undefined) {
      headers.set("content-type", "application/json");
      requestInit.body = JSON.stringify(parsedInput);
    }

    const response = await fetchImpl(`${baseUrl}${path}${buildQueryString(query)}`, requestInit);
    const rawBody = parseResponseBody(await response.text());

    if (!response.ok) {
      throw new ApiClientError(
        getErrorMessageFromResponseBody(rawBody, response.status, response.statusText),
        response.status,
        rawBody,
        response.headers,
      );
    }

    return outputSchema.parse(rawBody);
  }

  return {
    getMe(): Promise<MeResponse> {
      return requestJson({
        method: "GET",
        path: "/me",
        outputSchema: meResponseSchema,
      });
    },

    createLoginCode(): Promise<LoginCodeResponse> {
      return requestJson({
        method: "POST",
        path: "/auth/login-code",
        outputSchema: loginCodeResponseSchema,
      });
    },

    redeemLoginCode(input: RedeemLoginCodeBody): Promise<RedeemLoginCodeResponse> {
      return requestJson({
        method: "POST",
        path: "/auth/redeem-code",
        input,
        inputSchema: redeemLoginCodeBodySchema,
        outputSchema: redeemLoginCodeResponseSchema,
        includeAuth: false,
      });
    },

    getCharactersLatest(input: CharactersLatestQuery): Promise<SerializedPinnedCharacter[]> {
      const parsedQuery = charactersLatestQuerySchema.parse(input);
      return requestJson({
        method: "GET",
        path: "/characters/latest",
        query: {
          characterId: normalizeCharacterIds(parsedQuery),
        },
        outputSchema: charactersLatestResponseSchema,
      });
    },

    getMyCharacters(): Promise<SerializedDashboardCharacter[] | null> {
      return requestJson({
        method: "GET",
        path: "/characters",
        outputSchema: myCharactersResponseSchema,
      });
    },

    getScoreboardCharacters(): Promise<ScoreboardCharacterEntry[]> {
      return requestJson({
        method: "GET",
        path: "/characters/scoreboard",
        outputSchema: charactersScoreboardResponseSchema,
      });
    },

    getPlayerScoreboard(): Promise<PlayerScoreboardEntry[]> {
      return requestJson({
        method: "GET",
        path: "/scoreboard/players",
        outputSchema: playerScoreboardResponseSchema,
      });
    },

    getBoosterCharactersForExport(): Promise<CharacterBoosterExportEntry[]> {
      return requestJson({
        method: "GET",
        path: "/characters/boosters/export",
        outputSchema: boosterCharactersExportResponseSchema,
      });
    },

    resyncCharacters(): Promise<ResyncCharactersResponse> {
      return requestJson({
        method: "POST",
        path: "/characters/resync",
        outputSchema: resyncCharactersResponseSchema,
      });
    },

    getPlayerCharacters(playerId: string): Promise<PlayerCharactersResponse | null> {
      const { id } = playerRouteParamsSchema.parse({ id: playerId });
      return requestJson({
        method: "GET",
        path: `/players/${id}/characters`,
        outputSchema: playerCharactersResultSchema,
      });
    },

    getCharacterPage(
      characterId: string,
      input: CharacterPageQuery,
    ): Promise<CharacterPageResponse | null> {
      const { id } = characterRouteParamsSchema.parse({ id: characterId });
      const pathId = encodePathSegment(id);
      const parsedQuery = characterPageQuerySchema.parse(input);
      return requestJson({
        method: "GET",
        path: `/characters/${pathId}/page`,
        query: {
          timeFrame: parsedQuery.timeFrame,
          ...(parsedQuery.includeStats !== undefined
            ? { includeStats: parsedQuery.includeStats }
            : {}),
        },
        outputSchema: characterPageResultSchema,
      });
    },

    getCharacterDetailTimeline(
      characterId: string,
      input: CharacterDetailTimelineQuery,
    ): Promise<CharacterDetailTimelineResponse | null> {
      const { id } = characterRouteParamsSchema.parse({ id: characterId });
      const pathId = encodePathSegment(id);
      const parsedQuery = characterDetailTimelineQuerySchema.parse(input);
      return requestJson({
        method: "GET",
        path: `/characters/${pathId}/detail-timeline`,
        query: {
          timeFrame: parsedQuery.timeFrame,
          metric: parsedQuery.metric,
        },
        outputSchema: characterDetailTimelineResultSchema,
      });
    },

    getCharacterSnapshotTimeline(
      characterId: string,
      input: CharacterSnapshotTimelineQuery,
    ): Promise<CharacterSnapshotTimelineResponse | null> {
      const { id } = characterRouteParamsSchema.parse({ id: characterId });
      const pathId = encodePathSegment(id);
      const parsedQuery = characterSnapshotTimelineQuerySchema.parse(input);
      return requestJson({
        method: "GET",
        path: `/characters/${pathId}/snapshot-timeline`,
        query: {
          timeFrame: parsedQuery.timeFrame,
        },
        outputSchema: characterSnapshotTimelineResultSchema,
      });
    },

    getCharacterMythicPlus(
      characterId: string,
      input: CharacterMythicPlusQuery = {},
    ): Promise<CharacterMythicPlusResponse | null> {
      const { id } = characterRouteParamsSchema.parse({ id: characterId });
      const pathId = encodePathSegment(id);
      const parsedQuery = characterMythicPlusQuerySchema.parse(input);
      return requestJson({
        method: "GET",
        path: `/characters/${pathId}/mythic-plus`,
        query:
          parsedQuery.includeAllRuns !== undefined
            ? { includeAllRuns: parsedQuery.includeAllRuns }
            : undefined,
        outputSchema: characterMythicPlusResultSchema,
      });
    },

    updatePlayerDiscordUserId(
      playerId: string,
      input: UpdatePlayerDiscordBody,
    ): Promise<UpdatePlayerDiscordResponse> {
      const { id } = playerRouteParamsSchema.parse({ id: playerId });
      return requestJson({
        method: "PATCH",
        path: `/players/${id}/discord`,
        input,
        inputSchema: updatePlayerDiscordBodySchema,
        outputSchema: updatePlayerDiscordResponseSchema,
      });
    },

    updateCharacterBoosterStatus(
      characterId: string,
      input: UpdateCharacterBoosterBody,
    ): Promise<UpdateCharacterBoosterResponse> {
      const { id } = characterRouteParamsSchema.parse({ id: characterId });
      const pathId = encodePathSegment(id);
      return requestJson({
        method: "PATCH",
        path: `/characters/${pathId}/booster`,
        input,
        inputSchema: updateCharacterBoosterBodySchema,
        outputSchema: updateCharacterBoosterResponseSchema,
      });
    },

    updateCharacterNonTradeableSlots(
      characterId: string,
      input: UpdateCharacterSlotsBody,
    ): Promise<UpdateCharacterSlotsResponse> {
      const { id } = characterRouteParamsSchema.parse({ id: characterId });
      const pathId = encodePathSegment(id);
      return requestJson({
        method: "PATCH",
        path: `/characters/${pathId}/slots`,
        input,
        inputSchema: updateCharacterSlotsBodySchema,
        outputSchema: updateCharacterSlotsResponseSchema,
      });
    },

    ingestAddonData(input: AddonIngestBody): Promise<AddonIngestResponse> {
      return requestJson({
        method: "POST",
        path: "/addon/ingest",
        input,
        inputSchema: addonIngestBodySchema,
        outputSchema: addonIngestResponseSchema,
      });
    },
  };
}

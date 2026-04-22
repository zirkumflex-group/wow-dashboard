import { z } from "zod";

export const charactersLatestQuerySchema = z.object({
  characterId: z.array(z.string().uuid()).default([]),
});

export const playerRouteParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updatePlayerDiscordBodySchema = z.object({
  discordUserId: z.string().nullable(),
});

export type CharactersLatestQuery = z.infer<typeof charactersLatestQuerySchema>;
export type PlayerRouteParams = z.infer<typeof playerRouteParamsSchema>;
export type UpdatePlayerDiscordBody = z.infer<typeof updatePlayerDiscordBodySchema>;

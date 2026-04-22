import { z } from "zod";

export const queueNames = {
  syncCharacters: "sync-characters",
  deduplicateSnapshots: "deduplicate-snapshots",
} as const;

export const loginCodeTtlSeconds = 60;

export const syncCharactersJobPayloadSchema = z.object({
  userId: z.string().min(1),
  accessToken: z.string().min(1),
});

export type QueueName = (typeof queueNames)[keyof typeof queueNames];
export type SyncCharactersJobPayload = z.infer<typeof syncCharactersJobPayloadSchema>;

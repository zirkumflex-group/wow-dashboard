import { z } from "zod";

export const queueNames = {
  syncCharacters: "sync-characters",
  syncCharactersDeadLetter: "sync-characters-dead-letter",
} as const;

export const syncCharactersQueueOptions = {
  retryLimit: 4,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 5 * 60,
  expireInSeconds: 3 * 60,
  retentionSeconds: 7 * 24 * 60 * 60,
  deleteAfterSeconds: 24 * 60 * 60,
  deadLetter: queueNames.syncCharactersDeadLetter,
  warningQueueSize: 100,
} as const;

export const syncCharactersDeadLetterQueueOptions = {
  retryLimit: 0,
  retentionSeconds: 30 * 24 * 60 * 60,
  deleteAfterSeconds: 30 * 24 * 60 * 60,
  warningQueueSize: 25,
} as const;

export const loginCodeTtlSeconds = 5 * 60;
export const mythicPlusPreviewRunLimit = 50;

export const syncCharactersJobPayloadSchema = z.object({
  userId: z.string().min(1),
});

export type QueueName = (typeof queueNames)[keyof typeof queueNames];
export type SyncCharactersJobPayload = z.infer<typeof syncCharactersJobPayloadSchema>;

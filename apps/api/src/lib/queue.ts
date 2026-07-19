import { PgBoss } from "pg-boss";
import {
  queueNames,
  syncCharactersDeadLetterQueueOptions,
  syncCharactersJobPayloadSchema,
  syncCharactersQueueOptions,
  type SyncCharactersJobPayload,
} from "@wow-dashboard/api-schema";
import { env } from "@wow-dashboard/env/api";
import { logger } from "./logger";

let queuePromise: Promise<PgBoss> | null = null;
let queueIsClosing = false;

function isExpectedQueueShutdownError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: string; message?: string };

  return (
    candidate.code === "57P01" ||
    candidate.code === "57P02" ||
    candidate.message === "Connection terminated unexpectedly" ||
    candidate.message === "terminating connection due to administrator command"
  );
}

function attachQueueErrorHandler(queue: PgBoss) {
  queue.on("error", (error: unknown) => {
    if (queueIsClosing && isExpectedQueueShutdownError(error)) {
      return;
    }

    logger.error("queue.error", { error });
  });
}

async function ensureQueue(
  queue: PgBoss,
  name: string,
  options: Parameters<PgBoss["createQueue"]>[1],
): Promise<void> {
  const existingQueue = await queue.getQueue(name);
  if (!existingQueue) {
    await queue.createQueue(name, options);
    return;
  }

  await queue.updateQueue(name, options);
}

async function createQueue(): Promise<PgBoss> {
  const queue = new PgBoss({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3_000,
  });
  attachQueueErrorHandler(queue);

  await queue.start();
  await ensureQueue(
    queue,
    queueNames.syncCharactersDeadLetter,
    syncCharactersDeadLetterQueueOptions,
  );
  await ensureQueue(queue, queueNames.syncCharacters, syncCharactersQueueOptions);
  return queue;
}

async function getQueue(): Promise<PgBoss> {
  if (!queuePromise) {
    queuePromise = createQueue().catch((error) => {
      queuePromise = null;
      throw error;
    });
  }

  return queuePromise;
}

export async function enqueueSyncCharactersJob(payload: SyncCharactersJobPayload) {
  const queue = await getQueue();
  const data = syncCharactersJobPayloadSchema.parse(payload);
  const result = await queue.upsert(queueNames.syncCharacters, data, {
    singletonKey: data.userId,
  });

  return {
    jobId: result.jobs[0] ?? null,
    inserted: result.inserted === 1,
    deduplicated: result.updated > 0,
  };
}

export async function checkQueueHealth(): Promise<void> {
  const queue = await getQueue();
  const [stats] = await queue.getQueueStats(queueNames.syncCharacters, { force: true });
  if (!stats) {
    throw new Error(`Queue ${queueNames.syncCharacters} is unavailable`);
  }
}

export async function closeQueue(): Promise<void> {
  if (!queuePromise) return;

  const queue = await queuePromise.catch(() => null);
  queuePromise = null;

  if (queue) {
    queueIsClosing = true;

    try {
      await queue.stop({ close: true, graceful: true, timeout: 10_000 });
    } finally {
      queueIsClosing = false;
    }
  }
}

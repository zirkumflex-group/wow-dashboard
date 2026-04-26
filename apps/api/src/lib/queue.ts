import { PgBoss } from "pg-boss";
import {
  queueNames,
  syncCharactersJobPayloadSchema,
  type SyncCharactersJobPayload,
} from "@wow-dashboard/api-schema";
import { env } from "@wow-dashboard/env/server";

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

    console.error("[api] pg-boss error", error);
  });
}

async function ensureQueue(queue: PgBoss, name: string): Promise<void> {
  const existingQueue = await queue.getQueue(name);
  if (!existingQueue) {
    await queue.createQueue(name);
  }
}

async function createQueue(): Promise<PgBoss> {
  const queue = new PgBoss({
    connectionString: env.DATABASE_URL,
  });
  attachQueueErrorHandler(queue);

  await queue.start();
  await ensureQueue(queue, queueNames.syncCharacters);
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

export async function enqueueSyncCharactersJob(payload: SyncCharactersJobPayload): Promise<void> {
  const queue = await getQueue();
  const data = syncCharactersJobPayloadSchema.parse(payload);
  await queue.send(queueNames.syncCharacters, data);
}

export async function closeQueue(): Promise<void> {
  if (!queuePromise) return;

  const queue = await queuePromise.catch(() => null);
  queuePromise = null;

  if (queue) {
    queueIsClosing = true;

    try {
      await queue.stop();
    } finally {
      queueIsClosing = false;
    }
  }
}

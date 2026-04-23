import PgBoss from "pg-boss";
import {
  queueNames,
  syncCharactersJobPayloadSchema,
  type SyncCharactersJobPayload,
} from "@wow-dashboard/api-schema";
import { env } from "@wow-dashboard/env/server";
import { closeWorkerDatabase } from "./db";
import { syncCharacters } from "./jobs/syncCharacters";

let workerIsShuttingDown = false;

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

function attachBossErrorHandler(boss: PgBoss) {
  boss.on("error", (error) => {
    if (workerIsShuttingDown && isExpectedQueueShutdownError(error)) {
      return;
    }

    console.error("[worker] pg-boss error", error);
  });
}

async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  const existingQueue = await boss.getQueue(name);
  if (!existingQueue) {
    await boss.createQueue(name);
  }
}

export async function startWorker() {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
  });
  attachBossErrorHandler(boss);

  await boss.start();
  await ensureQueue(boss, queueNames.syncCharacters);

  await boss.work(
    queueNames.syncCharacters,
    async (jobs: PgBoss.Job<SyncCharactersJobPayload>[]) => {
      for (const job of jobs) {
        const payload = syncCharactersJobPayloadSchema.parse(job.data);
        const result = await syncCharacters(payload);
        console.log("[worker] syncCharacters completed", {
          jobId: job.id,
          ...result,
        });
      }
    },
  );

  console.log("[worker] listening for jobs");
  return boss;
}

export async function shutdownWorker(boss: PgBoss, signal: string) {
  console.log(`[worker] shutting down on ${signal}`);
  workerIsShuttingDown = true;

  try {
    await boss.stop();
    await closeWorkerDatabase();
  } finally {
    workerIsShuttingDown = false;
  }
}

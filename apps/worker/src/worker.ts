import { PgBoss, type Job } from "pg-boss";
import {
  queueNames,
  syncCharactersJobPayloadSchema,
  type SyncCharactersJobPayload,
} from "@wow-dashboard/api-schema";
import { env } from "@wow-dashboard/env/server";
import { closeWorkerDatabase } from "./db";
import { syncCharacters } from "./jobs/syncCharacters";

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

  await boss.start();
  await ensureQueue(boss, queueNames.syncCharacters);

  await boss.work(
    queueNames.syncCharacters,
    async (jobs: Job<SyncCharactersJobPayload>[]) => {
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
  await boss.stop();
  await closeWorkerDatabase();
}

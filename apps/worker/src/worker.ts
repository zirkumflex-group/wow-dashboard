import PgBoss from "pg-boss";
import { queueNames, syncCharactersJobPayloadSchema } from "@wow-dashboard/api-schema";
import { env } from "@wow-dashboard/env/server";
import { closeWorkerDatabase } from "./db";
import { deduplicateSnapshots } from "./jobs/deduplicateSnapshots";
import { syncCharacters } from "./jobs/syncCharacters";

const deduplicateSnapshotsCron = "0 5 * * *";

async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  const existingQueue = await boss.getQueue(name);
  if (!existingQueue) {
    await boss.createQueue(name);
  }
}

async function startWorker() {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
  });

  await boss.start();
  await ensureQueue(boss, queueNames.syncCharacters);
  await ensureQueue(boss, queueNames.deduplicateSnapshots);
  await boss.schedule(queueNames.deduplicateSnapshots, deduplicateSnapshotsCron, {});

  await boss.work(queueNames.syncCharacters, async (jobs) => {
    for (const job of jobs) {
      const payload = syncCharactersJobPayloadSchema.parse(job.data);
      const result = await syncCharacters(payload);
      console.log("[worker] syncCharacters completed", {
        jobId: job.id,
        ...result,
      });
    }
  });

  await boss.work(queueNames.deduplicateSnapshots, async (jobs) => {
    for (const job of jobs) {
      const result = await deduplicateSnapshots();
      console.log("[worker] deduplicateSnapshots completed", {
        jobId: job.id,
        ...result,
      });
    }
  });

  console.log("[worker] listening for jobs");
  return boss;
}

async function shutdown(boss: PgBoss, signal: string) {
  console.log(`[worker] shutting down on ${signal}`);
  await boss.stop();
  await closeWorkerDatabase();
}

if (import.meta.main) {
  const boss = await startWorker();

  const handleSignal = (signal: string) => {
    void shutdown(boss, signal).finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
}

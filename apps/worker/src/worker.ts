import { PgBoss, type Job } from "pg-boss";
import { createServer, type Server } from "node:http";
import {
  queueNames,
  syncCharactersDeadLetterQueueOptions,
  syncCharactersJobPayloadSchema,
  syncCharactersQueueOptions,
  type SyncCharactersJobPayload,
} from "@wow-dashboard/api-schema";
import { BattleNetRequestError } from "@wow-dashboard/battlenet";
import { env } from "@wow-dashboard/env/worker";
import { closeWorkerDatabase } from "./db";
import { syncCharacters } from "./jobs/syncCharacters";
import { insertWorkerAuditEvent } from "./audit";
import { logger } from "./logger";

let workerIsShuttingDown = false;

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timeoutId.unref();

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

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
  boss.on("error", (error: unknown) => {
    if (workerIsShuttingDown && isExpectedQueueShutdownError(error)) {
      return;
    }

    logger.error("queue.error", { error });
  });
}

async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: Parameters<PgBoss["createQueue"]>[1],
): Promise<void> {
  const existingQueue = await boss.getQueue(name);
  if (!existingQueue) {
    await boss.createQueue(name, options);
    return;
  }

  await boss.updateQueue(name, options);
}

async function writeWorkerAuditSafely(
  event: string,
  values: Parameters<typeof insertWorkerAuditEvent>[1],
) {
  try {
    await insertWorkerAuditEvent(event, values);
  } catch (error) {
    logger.warn("audit.persist_failed", { auditEvent: event, error });
  }
}

async function startHealthServer(boss: PgBoss): Promise<Server> {
  const port = env.WORKER_HEALTH_PORT;
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");

    if (request.url === "/healthz") {
      response.statusCode = workerIsShuttingDown ? 503 : 200;
      response.end(JSON.stringify({ ok: !workerIsShuttingDown }));
      return;
    }

    if (request.url === "/readyz") {
      try {
        if (workerIsShuttingDown) throw new Error("Worker is shutting down");
        const [queue] = await withDeadline(
          boss.getQueueStats(queueNames.syncCharacters, { force: true }),
          3_000,
        );
        if (!queue) {
          throw new Error(`Queue ${queueNames.syncCharacters} is unavailable`);
        }
        response.statusCode = 200;
        response.end(
          JSON.stringify({
            ok: true,
            queue: {
              ready: queue.readyCount,
              active: queue.activeCount,
              failed: queue.failedCount,
              deferred: queue.deferredCount,
            },
          }),
        );
      } catch (error) {
        logger.warn("health.ready_failed", { error });
        response.statusCode = 503;
        response.end(JSON.stringify({ ok: false }));
      }
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    const handleStartupError = (error: Error) => reject(error);
    server.once("error", handleStartupError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", handleStartupError);
      resolve();
    });
  });

  server.on("error", (error) => logger.error("health.server_error", { error }));
  logger.info("health.listening", { host: "0.0.0.0", port });
  return server;
}

function closeHealthServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export type WorkerRuntime = {
  boss: PgBoss;
  healthServer: Server;
};

export async function startWorker() {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3_000,
  });
  attachBossErrorHandler(boss);

  try {
    await boss.start();
    await ensureQueue(
      boss,
      queueNames.syncCharactersDeadLetter,
      syncCharactersDeadLetterQueueOptions,
    );
    await ensureQueue(boss, queueNames.syncCharacters, syncCharactersQueueOptions);

    await boss.work(queueNames.syncCharacters, async (jobs: Job<SyncCharactersJobPayload>[]) => {
      for (const job of jobs) {
        const payload = syncCharactersJobPayloadSchema.parse(job.data);
        try {
          const result = await syncCharacters(payload, { signal: job.signal });
          await writeWorkerAuditSafely("battlenet.sync.completed", {
            userId: payload.userId,
            metadata: {
              jobId: job.id,
              ...result,
            },
          });
          logger.info("battlenet.sync.completed", {
            jobId: job.id,
            ...result,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retryable = !(error instanceof BattleNetRequestError) || error.retryable;
          await writeWorkerAuditSafely("battlenet.sync.failed", {
            userId: payload.userId,
            metadata: { jobId: job.id, retryable },
            error: message,
          });
          logger.error("battlenet.sync.failed", {
            jobId: job.id,
            userId: payload.userId,
            retryable,
            error,
          });
          if (retryable) {
            throw error;
          }
        }
      }
    });

    const healthServer = await startHealthServer(boss);
    logger.info("queue.listening", { queue: queueNames.syncCharacters });
    return { boss, healthServer } satisfies WorkerRuntime;
  } catch (error) {
    workerIsShuttingDown = true;
    const cleanup = await Promise.allSettled([
      boss.stop({ close: true, graceful: false, timeout: 5_000 }),
      closeWorkerDatabase(),
    ]);
    workerIsShuttingDown = false;
    for (const result of cleanup) {
      if (result.status === "rejected") {
        logger.warn("worker.startup_cleanup_failed", { error: result.reason });
      }
    }
    throw error;
  }
}

export async function shutdownWorker(runtime: WorkerRuntime, signal: string) {
  logger.info("worker.shutdown.started", { signal });
  workerIsShuttingDown = true;

  try {
    const healthResults = await Promise.allSettled([closeHealthServer(runtime.healthServer)]);
    const dependencyResults = await Promise.allSettled([
      runtime.boss.stop({ close: true, graceful: true, timeout: 30_000 }),
      closeWorkerDatabase(),
    ]);
    const failures = [...healthResults, ...dependencyResults].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, "Worker shutdown did not close every resource");
    }
  } finally {
    workerIsShuttingDown = false;
  }

  logger.info("worker.shutdown.completed", { signal });
}

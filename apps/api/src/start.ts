import { closeApiDatabase } from "./db";
import { closeQueue } from "./lib/queue";
import { closeRedis } from "./lib/redis";
import { logger } from "./lib/logger";
import { startApi } from "./server";

const shutdownTimeoutMs = 10_000;

function closeHttpServer(server: ReturnType<typeof startApi>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      logger.warn("server.shutdown.http_timeout", { timeoutMs: shutdownTimeoutMs });
      if ("closeAllConnections" in server) {
        server.closeAllConnections();
      }
      resolve();
    }, shutdownTimeoutMs);
    timeoutId.unref();

    server.close((error) => {
      clearTimeout(timeoutId);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const server = startApi();
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("server.shutdown.started", { signal });

    const httpResults = await Promise.allSettled([closeHttpServer(server)]);
    const dependencyResults = await Promise.allSettled([
      closeQueue(),
      closeRedis(),
      closeApiDatabase(),
    ]);
    const failures = [...httpResults, ...dependencyResults].filter(
      (result) => result.status === "rejected",
    );

    if (failures.length > 0) {
      logger.error("server.shutdown.failed", {
        failures: failures.map((failure) =>
          failure.status === "rejected" ? failure.reason : undefined,
        ),
      });
      process.exitCode = 1;
      return;
    }

    logger.info("server.shutdown.completed", { signal });
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((error) => {
  logger.error("server.startup.failed", { error });
  process.exitCode = 1;
});

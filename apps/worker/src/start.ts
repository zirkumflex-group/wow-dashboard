import { shutdownWorker, startWorker } from "./worker";
import { logger } from "./logger";

async function main() {
  const runtime = await startWorker();
  let shuttingDown = false;

  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void shutdownWorker(runtime, signal).catch((error) => {
      logger.error("worker.shutdown.failed", { signal, error });
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}

void main().catch((error) => {
  logger.error("worker.startup.failed", { error });
  process.exitCode = 1;
});

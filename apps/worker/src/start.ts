import { shutdownWorker, startWorker } from "./worker";

async function main() {
  const boss = await startWorker();

  const handleSignal = (signal: string) => {
    void shutdownWorker(boss, signal).finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
}

void main();

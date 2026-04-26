import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";

function findRepoRoot(startDir: string) {
  let currentDir = startDir;

  while (true) {
    if (existsSync(resolve(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }

    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(process.env.INIT_CWD ?? process.cwd());
const nodeEnv = process.env.NODE_ENV ?? "development";

const envFiles = [
  `.env.${nodeEnv}.local`,
  ".env.local",
  `.env.${nodeEnv}`,
  ".env",
].map((fileName) => resolve(repoRoot, fileName));

for (const path of envFiles) {
  if (!existsSync(path)) continue;
  config({ path, override: false });
}

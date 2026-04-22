import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
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

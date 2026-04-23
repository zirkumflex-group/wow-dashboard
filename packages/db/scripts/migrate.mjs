import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const migrationsFolder = resolve(packageRoot, "drizzle");

loadRootEnv();

const databaseUrl = process.env.DATABASE_URL ?? "postgres://wowdash:wowdash@localhost:5432/wowdash";

const client = postgres(databaseUrl, {
  max: 1,
  onnotice: () => {},
  prepare: false,
});

try {
  console.log(`[db] applying migrations from ${migrationsFolder}`);
  await migrate(drizzle(client), { migrationsFolder });
  console.log("[db] migrations complete");
} catch (error) {
  console.error("[db] migration failed");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}

function loadRootEnv() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const envFiles = [`.env.${nodeEnv}.local`, ".env.local", `.env.${nodeEnv}`, ".env"].map(
    (fileName) => resolve(repoRoot, fileName),
  );

  for (const path of envFiles) {
    if (!existsSync(path)) continue;
    loadDotenv({ path, override: false });
  }
}

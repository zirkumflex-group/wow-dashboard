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

const defaultDatabaseUrl = "postgres://wowdash:wowdash@localhost:5432/wowdash";
const databaseUrl = process.env.DATABASE_URL ?? resolveDevelopmentDatabaseUrl();

if (
  (process.env.NODE_ENV ?? "development") === "production" &&
  databaseUrl === defaultDatabaseUrl
) {
  console.error("[db] DATABASE_URL must be set to a non-default value when NODE_ENV=production");
  process.exit(1);
}

const client = postgres(databaseUrl, {
  max: 1,
  onnotice: () => {},
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 30,
  max_lifetime: 10 * 60,
  connection: {
    application_name: "wow-dashboard-migrate",
    statement_timeout: 10 * 60 * 1000,
    lock_timeout: 30 * 1000,
    idle_in_transaction_session_timeout: 60 * 1000,
  },
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

function resolveDevelopmentDatabaseUrl() {
  if ((process.env.NODE_ENV ?? "development") === "production") {
    console.error("[db] DATABASE_URL must be set when NODE_ENV=production");
    process.exit(1);
  }

  return defaultDatabaseUrl;
}

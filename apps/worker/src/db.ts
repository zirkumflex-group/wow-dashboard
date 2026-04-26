import { closeDatabaseConnection, createDatabaseConnection } from "@wow-dashboard/db";
import { env } from "@wow-dashboard/env/server";

const databaseConnection = createDatabaseConnection(env.DATABASE_URL);
export const db = databaseConnection.db;

export async function closeWorkerDatabase(): Promise<void> {
  await closeDatabaseConnection(databaseConnection);
}

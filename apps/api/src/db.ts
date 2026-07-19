import { closeDatabaseConnection, createDatabaseConnection } from "@wow-dashboard/db";
import { env } from "@wow-dashboard/env/api";

export const databaseConnection = createDatabaseConnection(env.DATABASE_URL);
export const db = databaseConnection.db;

export async function closeApiDatabase(): Promise<void> {
  await closeDatabaseConnection(databaseConnection);
}

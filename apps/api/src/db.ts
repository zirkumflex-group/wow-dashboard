import { createDatabaseConnection } from "@wow-dashboard/db";
import { env } from "@wow-dashboard/env/server";

export const databaseConnection = createDatabaseConnection(env.DATABASE_URL);
export const db = databaseConnection.db;

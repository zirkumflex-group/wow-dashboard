import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

const defaultDatabaseUrl = "postgres://wowdash:wowdash@localhost:5432/wowdash";

export type SqlClient = ReturnType<typeof postgres>;
export type DatabaseClient = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  client: SqlClient;
  db: DatabaseClient;
}

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? defaultDatabaseUrl;
}

export function createDatabaseConnection(connectionString = getDatabaseUrl()): DatabaseConnection {
  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export async function closeDatabaseConnection(connection: DatabaseConnection): Promise<void> {
  await connection.client.end({ timeout: 5 });
}

import { auditLog } from "@wow-dashboard/db";
import { db } from "../db";

export async function insertAuditEvent(
  event: string,
  values: {
    userId?: string | null;
    metadata?: unknown;
    error?: string;
  } = {},
): Promise<void> {
  await db.insert(auditLog).values({
    userId: values.userId ?? null,
    event,
    metadata: values.metadata,
    error: values.error,
    timestamp: new Date(),
  });
}

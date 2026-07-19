import { and, desc, eq, gt } from "drizzle-orm";
import { session as authSessions } from "@wow-dashboard/db";
import { auth } from "../auth";
import { db } from "../db";
import { insertAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";

export async function readActiveSessions(userId: string, currentSessionId: string) {
  const rows = await db
    .select({
      id: authSessions.id,
      userAgent: authSessions.userAgent,
      createdAt: authSessions.createdAt,
      updatedAt: authSessions.updatedAt,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), gt(authSessions.expiresAt, new Date())))
    .orderBy(desc(authSessions.updatedAt));

  return rows.map((session) => ({
    id: session.id,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    isCurrent: session.id === currentSessionId,
  }));
}

export async function revokeOwnedSession(userId: string, sessionId: string) {
  const session = await db.query.session.findFirst({
    columns: {
      id: true,
      token: true,
    },
    where: and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)),
  });
  if (!session) return null;

  const authContext = await auth.$context;
  await authContext.internalAdapter.deleteSession(session.token);

  await insertAuditEvent("auth.session.revoked", {
    userId,
    metadata: { sessionId: session.id },
  }).catch((error) => {
    logger.warn("audit.persist_failed", { auditEvent: "auth.session.revoked", error });
  });

  return {
    sessionId: session.id,
    revoked: true as const,
  };
}

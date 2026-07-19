import { createBattleNetTokenService } from "@wow-dashboard/battlenet";
import { env } from "@wow-dashboard/env/worker";
import { insertWorkerAuditEvent } from "./audit";
import { db } from "./db";
import { logger } from "./logger";

const tokenService = createBattleNetTokenService({
  db,
  clientId: env.BATTLENET_CLIENT_ID,
  clientSecret: env.BATTLENET_CLIENT_SECRET,
  audit: insertWorkerAuditEvent,
  onAuditError: (error) => {
    logger.warn("audit.persist_failed", {
      auditEvent: "battlenet.token.refreshed",
      error,
    });
  },
});

export const resolveBattleNetAccessTokenForUser = tokenService.resolveForUser;

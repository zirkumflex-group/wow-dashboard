import { createBattleNetTokenService } from "@wow-dashboard/battlenet";
import { env } from "@wow-dashboard/env/api";
import { db } from "../db";
import { insertAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";

const tokenService = createBattleNetTokenService({
  db,
  clientId: env.BATTLENET_CLIENT_ID,
  clientSecret: env.BATTLENET_CLIENT_SECRET,
  audit: insertAuditEvent,
  onAuditError: (error) => {
    logger.warn("audit.persist_failed", {
      auditEvent: "battlenet.token.refreshed",
      error,
    });
  },
});

export const resolveBattleNetAccessTokenForUser = tokenService.resolveForUser;

import { and, eq } from "drizzle-orm";
import { players } from "@wow-dashboard/db";
import { db } from "../db";
import { insertAuditEvent } from "../lib/audit";

function normalizeDiscordUserId(discordUserId: string | null): string | null {
  if (discordUserId === null) {
    return null;
  }

  const trimmedDiscordUserId = discordUserId.trim();
  if (trimmedDiscordUserId === "") {
    return null;
  }

  const mentionMatch = trimmedDiscordUserId.match(/^<@!?(\d+)>$/);
  const normalizedDiscordUserId = mentionMatch?.[1] ?? trimmedDiscordUserId;

  if (!/^\d{5,30}$/.test(normalizedDiscordUserId)) {
    throw new Error("Discord ID must be a numeric user ID or mention.");
  }

  return normalizedDiscordUserId;
}

export async function updatePlayerDiscordSettings(
  playerId: string,
  userId: string,
  input: {
    discordUserId?: string | null;
    shareDiscordInBoosterExport?: boolean;
  },
): Promise<{
  playerId: string;
  discordUserId: string | null;
  shareDiscordInBoosterExport: boolean;
} | null> {
  const result = await db.transaction(async (tx) => {
    const currentPlayer = await tx.query.players.findFirst({
      where: and(eq(players.id, playerId), eq(players.userId, userId)),
      columns: {
        id: true,
        discordUserId: true,
        shareDiscordInBoosterExport: true,
      },
    });

    if (!currentPlayer) return null;

    const discordUserId =
      input.discordUserId === undefined
        ? currentPlayer.discordUserId
        : normalizeDiscordUserId(input.discordUserId);
    const shareDiscordInBoosterExport =
      discordUserId === null
        ? false
        : (input.shareDiscordInBoosterExport ?? currentPlayer.shareDiscordInBoosterExport);

    const [updatedPlayer] = await tx
      .update(players)
      .set({
        discordUserId,
        shareDiscordInBoosterExport,
      })
      .where(and(eq(players.id, playerId), eq(players.userId, userId)))
      .returning({
        id: players.id,
        discordUserId: players.discordUserId,
        shareDiscordInBoosterExport: players.shareDiscordInBoosterExport,
      });

    return updatedPlayer ?? null;
  });

  if (!result) {
    return null;
  }

  await insertAuditEvent("player.discord_settings.updated", {
    userId,
    metadata: {
      playerId: result.id,
      hasDiscordUserId: result.discordUserId !== null,
      shareDiscordInBoosterExport: result.shareDiscordInBoosterExport,
    },
  });

  return {
    playerId: result.id,
    discordUserId: result.discordUserId,
    shareDiscordInBoosterExport: result.shareDiscordInBoosterExport,
  };
}

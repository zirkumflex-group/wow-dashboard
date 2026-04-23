import { and, eq } from "drizzle-orm";
import { players } from "@wow-dashboard/db";
import { db } from "../db";

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

export async function updatePlayerDiscordUserId(
  playerId: string,
  userId: string,
  discordUserId: string | null,
): Promise<{ playerId: string; discordUserId: string | null } | null> {
  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);

  const [updatedPlayer] = await db
    .update(players)
    .set({
      discordUserId: normalizedDiscordUserId,
    })
    .where(and(eq(players.id, playerId), eq(players.userId, userId)))
    .returning({
      id: players.id,
      discordUserId: players.discordUserId,
    });

  if (!updatedPlayer) {
    return null;
  }

  return {
    playerId: updatedPlayer.id,
    discordUserId: updatedPlayer.discordUserId,
  };
}

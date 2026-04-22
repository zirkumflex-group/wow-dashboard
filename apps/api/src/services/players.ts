import { eq } from "drizzle-orm";
import { players } from "@wow-dashboard/db";
import { db } from "../db";

export function normalizeDiscordUserId(discordUserId: string | null): string | null {
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
  discordUserId: string | null,
): Promise<{ playerId: string; discordUserId: string | null } | null> {
  const player = await db.query.players.findFirst({
    where: eq(players.id, playerId),
  });

  if (!player) {
    return null;
  }

  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);

  await db
    .update(players)
    .set({
      discordUserId: normalizedDiscordUserId,
    })
    .where(eq(players.id, playerId));

  return {
    playerId,
    discordUserId: normalizedDiscordUserId,
  };
}

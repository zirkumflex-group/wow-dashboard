import { defineSchema } from "convex/server";
import { playersTable } from "./schemas/players";
import { charactersTable } from "./schemas/characters";
import { snapshotsTable } from "./schemas/snapshots";

export default defineSchema({
  players: playersTable,
  characters: charactersTable,
  snapshots: snapshotsTable,
});

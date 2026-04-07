import { defineTable } from "convex/server";
import { v } from "convex/values";

export const specValidator = v.union(
  // Death Knight
  v.literal("Blood"),
  v.literal("Frost"),
  v.literal("Unholy"),
  // Demon Hunter
  v.literal("Havoc"),
  v.literal("Vengeance"),
  v.literal("Devourer"),
  // Druid
  v.literal("Balance"),
  v.literal("Feral"),
  v.literal("Guardian"),
  v.literal("Restoration"),
  // Evoker
  v.literal("Augmentation"),
  v.literal("Devastation"),
  v.literal("Preservation"),
  // Hunter
  v.literal("Beast Mastery"),
  v.literal("Marksmanship"),
  v.literal("Survival"),
  // Mage
  v.literal("Arcane"),
  v.literal("Fire"),
  // Monk
  v.literal("Brewmaster"),
  v.literal("Mistweaver"),
  v.literal("Windwalker"),
  // Paladin
  v.literal("Holy"),
  v.literal("Protection"),
  v.literal("Retribution"),
  // Priest
  v.literal("Discipline"),
  v.literal("Shadow"),
  // Rogue
  v.literal("Assassination"),
  v.literal("Outlaw"),
  v.literal("Subtlety"),
  // Shaman
  v.literal("Elemental"),
  v.literal("Enhancement"),
  // Warlock
  v.literal("Affliction"),
  v.literal("Demonology"),
  v.literal("Destruction"),
  // Warrior
  v.literal("Arms"),
  v.literal("Fury"),
);

const validSnapshotSpecNames = new Set<string>([
  "Blood",
  "Frost",
  "Unholy",
  "Havoc",
  "Vengeance",
  "Devourer",
  "Balance",
  "Feral",
  "Guardian",
  "Restoration",
  "Augmentation",
  "Devastation",
  "Preservation",
  "Beast Mastery",
  "Marksmanship",
  "Survival",
  "Arcane",
  "Fire",
  "Brewmaster",
  "Mistweaver",
  "Windwalker",
  "Holy",
  "Protection",
  "Retribution",
  "Discipline",
  "Shadow",
  "Assassination",
  "Outlaw",
  "Subtlety",
  "Elemental",
  "Enhancement",
  "Affliction",
  "Demonology",
  "Destruction",
  "Arms",
  "Fury",
]);

export function normalizeSnapshotSpec(value: string): string | null {
  const normalized = value.trim();
  if (normalized === "" || normalized === "Unknown") {
    return null;
  }

  return validSnapshotSpecNames.has(normalized) ? normalized : null;
}

export const snapshotsTable = defineTable({
  characterId: v.id("characters"),
  takenAt: v.number(),
  level: v.number(),
  spec: specValidator,
  role: v.union(v.literal("tank"), v.literal("healer"), v.literal("dps")),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  playtimeThisLevelSeconds: v.optional(v.number()),
  mythicPlusScore: v.number(),
  currencies: v.object({
    adventurerDawncrest: v.number(),
    veteranDawncrest: v.number(),
    championDawncrest: v.number(),
    heroDawncrest: v.number(),
    mythDawncrest: v.number(),
    radiantSparkDust: v.number(),
  }),
  stats: v.object({
    stamina: v.number(),
    strength: v.number(),
    agility: v.number(),
    intellect: v.number(),
    critPercent: v.number(),
    hastePercent: v.number(),
    masteryPercent: v.number(),
    versatilityPercent: v.number(),
    speedPercent: v.optional(v.number()),
    leechPercent: v.optional(v.number()),
    avoidancePercent: v.optional(v.number()),
  }),
})
  .index("by_character", ["characterId"])
  .index("by_character_and_time", ["characterId", "takenAt"]);

export const characterRegions = ["us", "eu", "kr", "tw"] as const;
export type CharacterRegion = (typeof characterRegions)[number];

export const characterFactions = ["alliance", "horde"] as const;
export type CharacterFaction = (typeof characterFactions)[number];

export const characterVisibilities = ["public", "unlisted", "private"] as const;
export type CharacterVisibility = (typeof characterVisibilities)[number];

export const battleNetVerificationStatuses = [
  "unverified",
  "verified",
  "not_found",
  "error",
] as const;
export type BattleNetVerificationStatus = (typeof battleNetVerificationStatuses)[number];

export const snapshotRoles = ["tank", "healer", "dps"] as const;
export type SnapshotRole = (typeof snapshotRoles)[number];

export const addonSignatureStates = ["unsigned", "valid", "invalid"] as const;
export type AddonSignatureState = (typeof addonSignatureStates)[number];

export const snapshotSpecs = [
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
] as const;
export type SnapshotSpec = (typeof snapshotSpecs)[number];

export const nonTradeableSlots = [
  "head",
  "shoulders",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "neck",
  "back",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "mainHand",
  "offHand",
] as const;
export type NonTradeableSlot = (typeof nonTradeableSlots)[number];

export const mythicPlusRunStatuses = ["active", "completed", "abandoned"] as const;
export type MythicPlusRunStatus = (typeof mythicPlusRunStatuses)[number];

export const mythicPlusAbandonReasons = [
  "challenge_mode_reset",
  "left_instance",
  "leaver_timer",
  "history_incomplete",
  "stale_recovery",
  "unknown",
] as const;
export type MythicPlusAbandonReason = (typeof mythicPlusAbandonReasons)[number];

export interface OwnedKeystone {
  level: number;
  mapChallengeModeID?: number;
  mapName?: string;
}

export interface Currencies {
  adventurerDawncrest: number;
  veteranDawncrest: number;
  championDawncrest: number;
  heroDawncrest: number;
  mythDawncrest: number;
  radiantSparkDust: number;
}

export interface SnapshotCurrencyInfo {
  currencyID: number;
  name?: string;
  quantity: number;
  iconFileID?: number;
  maxQuantity?: number;
  canEarnPerWeek?: boolean;
  quantityEarnedThisWeek?: number;
  maxWeeklyQuantity?: number;
  totalEarned?: number;
  discovered?: boolean;
  quality?: number;
  useTotalEarnedForMaxQty?: boolean;
}

export type SnapshotCurrencyDetails = Record<string, SnapshotCurrencyInfo>;

export interface SnapshotEquipmentItem {
  slot: string;
  slotID: number;
  itemID?: number;
  itemName?: string;
  itemLink?: string;
  itemLevel?: number;
  quality?: number;
  iconFileID?: number;
}

export type SnapshotEquipment = Record<string, SnapshotEquipmentItem>;

export interface SnapshotWeeklyRewardActivity {
  type?: number;
  index?: number;
  id?: number;
  level?: number;
  threshold?: number;
  progress?: number;
  activityTierID?: number;
  itemLevel?: number;
  name?: string;
}

export interface SnapshotWeeklyRewards {
  canClaimRewards?: boolean;
  isCurrentPeriod?: boolean;
  activities: SnapshotWeeklyRewardActivity[];
}

export interface SnapshotMajorFaction {
  factionID: number;
  name?: string;
  expansionID?: number;
  isUnlocked?: boolean;
  renownLevel?: number;
  renownReputationEarned?: number;
  renownLevelThreshold?: number;
  isWeeklyCapped?: boolean;
}

export interface SnapshotMajorFactions {
  factions: SnapshotMajorFaction[];
}

export interface SnapshotClientInfo {
  addonVersion?: string;
  interfaceVersion?: number;
  gameVersion?: string;
  buildNumber?: string;
  buildDate?: string;
  tocVersion?: number;
  expansion?: string;
  locale?: string;
}

export interface Stats {
  stamina: number;
  strength: number;
  agility: number;
  intellect: number;
  critRating?: number;
  critPercent: number;
  hasteRating?: number;
  hastePercent: number;
  masteryRating?: number;
  masteryPercent: number;
  versatilityRating?: number;
  versatilityPercent: number;
  speedRating?: number;
  speedPercent?: number;
  leechRating?: number;
  leechPercent?: number;
  avoidanceRating?: number;
  avoidancePercent?: number;
}

export interface LatestSnapshotSummary {
  takenAt: number;
  level: number;
  spec: SnapshotSpec;
  role: SnapshotRole;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
  mythicPlusScore: number;
  seasonID?: number;
  ownedKeystone?: OwnedKeystone;
}

export interface LatestSnapshotDetails extends LatestSnapshotSummary {
  currencies: Currencies;
  currencyDetails?: SnapshotCurrencyDetails;
  stats: Stats;
  equipment?: SnapshotEquipment;
  weeklyRewards?: SnapshotWeeklyRewards;
  majorFactions?: SnapshotMajorFactions;
  clientInfo?: SnapshotClientInfo;
}

export interface MythicPlusBucketSummary {
  totalRuns: number;
  totalAttempts?: number;
  completedRuns: number;
  abandonedRuns?: number;
  activeRuns?: number;
  timedRuns: number;
  timed2To9: number;
  timed10To11: number;
  timed12To13: number;
  timed14Plus: number;
  bestLevel: number | null;
  bestTimedLevel: number | null;
  bestTimedUpgradeCount: number | null;
  bestTimedScore: number | null;
  bestTimedDurationMs: number | null;
  bestScore: number | null;
  averageLevel: number | null;
  averageScore: number | null;
  lastRunAt: number | null;
}

export interface MythicPlusDungeonSummary {
  mapChallengeModeID: number | null;
  mapName: string;
  totalRuns: number;
  timedRuns: number;
  bestLevel: number | null;
  bestTimedLevel: number | null;
  bestTimedUpgradeCount: number | null;
  bestTimedScore: number | null;
  bestTimedDurationMs: number | null;
  bestScore: number | null;
  lastRunAt: number | null;
}

export interface MythicPlusSummary {
  latestSeasonID: number | null;
  currentScore: number | null;
  overall: MythicPlusBucketSummary;
  currentSeason: MythicPlusBucketSummary | null;
  currentSeasonDungeons: MythicPlusDungeonSummary[];
}

export interface MythicPlusRunMember {
  name: string;
  realm?: string;
  classTag?: string;
  role?: SnapshotRole;
}

export interface MythicPlusRunSessionPreview {
  id: string;
  position: number;
  runCount: number;
  isPaid: boolean;
  externalId: string | null;
}

export interface MythicPlusRecentRunPreview {
  _id?: string;
  _creationTime?: number;
  characterId?: string;
  rowKey: string;
  fingerprint: string;
  attemptId?: string;
  canonicalKey?: string;
  observedAt: number;
  playedAt: number;
  sortTimestamp: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  status?: MythicPlusRunStatus;
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  endedAt?: number;
  abandonedAt?: number;
  abandonReason?: MythicPlusAbandonReason;
  thisWeek?: boolean;
  members?: MythicPlusRunMember[];
  upgradeCount: number | null;
  scoreIncrease: number | null;
  session?: MythicPlusRunSessionPreview;
}

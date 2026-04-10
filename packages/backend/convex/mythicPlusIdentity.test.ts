import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __testables as ingestTestables } from "./addonIngest";
import { __testables as characterTestables } from "./characters";
import { getMythicPlusRunCanonicalKey } from "./mythicPlus";

type TestRun = {
  _id: string;
  _creationTime: number;
  characterId: string;
  fingerprint: string;
  observedAt: number;
  canonicalKey?: string;
  attemptId?: string;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  status?: "active" | "completed" | "abandoned";
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  endedAt?: number;
  abandonedAt?: number;
  abandonReason?:
    | "challenge_mode_reset"
    | "left_instance"
    | "leaver_timer"
    | "history_incomplete"
    | "stale_recovery"
    | "unknown";
  thisWeek?: boolean;
  members?: Array<{
    name: string;
    realm?: string;
    classTag?: string;
    role?: "tank" | "healer" | "dps";
  }>;
};

const makeLookups = () => ({
  byAttemptId: new Map<string, any>(),
  byCanonicalKey: new Map<string, any>(),
  byCompatibilityAlias: new Map<string, any>(),
});

let runSequence = 0;
function makeRun(partial: Partial<TestRun>): TestRun {
  runSequence += 1;
  return {
    _id: partial._id ?? `run-${runSequence}`,
    _creationTime: partial._creationTime ?? runSequence,
    characterId: partial.characterId ?? "char-1",
    fingerprint: partial.fingerprint ?? `fp-${runSequence}`,
    observedAt: partial.observedAt ?? 0,
    ...partial,
  };
}

describe("Mythic+ identity contract", () => {
  it("active -> completed resolves to the same ingest row", () => {
    const lookups = makeLookups();
    const active = makeRun({
      fingerprint: "attempt|s3|402|12|100000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 12,
      startDate: 100000,
      status: "active",
      observedAt: 100010,
    });
    ingestTestables.registerRunLookups(lookups, active as any);

    const completedIncoming = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "legacy-completed",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 12,
      completedAt: 101800,
      durationMs: 1_800_000,
      runScore: 243.2,
      status: "completed",
      observedAt: 101820,
    } as any);

    const matched = ingestTestables.findMatchingExistingRunByIdentity(lookups, completedIncoming);
    assert.equal(matched?._id, active._id);
  });

  it("active -> abandoned resolves to the same ingest row", () => {
    const lookups = makeLookups();
    const active = makeRun({
      fingerprint: "attempt|s3|402|9|200000",
      attemptId: "attempt|s3|402|9|200000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 9,
      startDate: 200000,
      status: "active",
      observedAt: 200015,
    });
    ingestTestables.registerRunLookups(lookups, active as any);

    const abandonedIncoming = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "legacy-abandoned",
      attemptId: "attempt|s3|402|9|200000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 9,
      abandonedAt: 201050,
      endedAt: 201050,
      status: "abandoned",
      observedAt: 201060,
    } as any);

    const matched = ingestTestables.findMatchingExistingRunByIdentity(lookups, abandonedIncoming);
    assert.equal(matched?._id, active._id);
  });

  it("mixed old/new payloads for the same run match via compatibility alias enrichment", () => {
    const lookups = makeLookups();
    const legacyStored = makeRun({
      fingerprint: "3|402|11|300000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 11,
      startDate: 300000,
      status: "active",
      observedAt: 300015,
    });
    ingestTestables.registerRunLookups(lookups, legacyStored as any);

    const newIncoming = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "new-parser-shape",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 11,
      completedAt: 301620,
      durationMs: 1_620_000,
      runScore: 201.4,
      status: "completed",
      observedAt: 301640,
    } as any);

    const matched = ingestTestables.findMatchingExistingRunByIdentity(lookups, newIncoming);
    assert.equal(matched?._id, legacyStored._id);
  });

  it("two distinct same-map same-level runs 20-30 minutes apart stay separate", () => {
    const first = makeRun({
      fingerprint: "first",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 12,
      completedAt: 400000,
      durationMs: 1_650_000,
      runScore: 250,
      status: "completed",
      observedAt: 400010,
    });
    const second = makeRun({
      fingerprint: "second",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 12,
      completedAt: 401500,
      durationMs: 1_700_000,
      runScore: 252,
      status: "completed",
      observedAt: 401510,
    });

    const lookups = makeLookups();
    ingestTestables.registerRunLookups(lookups, first as any);
    const ingestMatch = ingestTestables.findMatchingExistingRunByIdentity(
      lookups,
      ingestTestables.mergeMythicPlusRunData(undefined, second as any),
    );
    assert.equal(ingestMatch, undefined);

    const deduped = characterTestables.dedupeMythicPlusRuns([first as any, second as any]);
    assert.equal(deduped.length, 2);
  });

  it("exact +3600 legacy pair can merge only when core identity is the same", () => {
    const lookups = makeLookups();
    const existing = makeRun({
      fingerprint: "legacy-a",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 14,
      completedAt: 500000,
      durationMs: 1_800_000,
      runScore: 312.8,
      status: "completed",
      observedAt: 540000,
    });
    ingestTestables.registerRunLookups(lookups, existing as any);

    const shifted = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "legacy-b",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 14,
      completedAt: 503600,
      durationMs: 1_800_000,
      runScore: 312.8,
      status: "completed",
      observedAt: 543600,
    } as any);

    const matched = ingestTestables.findMatchingExistingRunByIdentity(lookups, shifted);
    assert.equal(matched?._id, existing._id);
    assert.notEqual(getMythicPlusRunCanonicalKey(existing as any), getMythicPlusRunCanonicalKey(shifted));
  });

  it("compatibility alias does not merge when duration or runScore differs", () => {
    const lookups = makeLookups();
    const existing = makeRun({
      fingerprint: "legacy-c",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 14,
      completedAt: 600000,
      durationMs: 1_800_000,
      runScore: 320,
      status: "completed",
      observedAt: 640000,
    });
    ingestTestables.registerRunLookups(lookups, existing as any);

    const differentScore = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "legacy-d",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 14,
      completedAt: 603600,
      durationMs: 1_800_000,
      runScore: 100,
      status: "completed",
      observedAt: 643600,
    } as any);
    const differentDuration = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "legacy-e",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 14,
      completedAt: 603600,
      durationMs: 1_200_000,
      runScore: 320,
      status: "completed",
      observedAt: 643600,
    } as any);

    assert.equal(ingestTestables.findMatchingExistingRunByIdentity(lookups, differentScore), undefined);
    assert.equal(ingestTestables.findMatchingExistingRunByIdentity(lookups, differentDuration), undefined);
  });
});

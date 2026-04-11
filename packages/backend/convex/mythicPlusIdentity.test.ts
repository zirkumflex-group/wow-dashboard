import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __testables as ingestTestables } from "./addonIngest";
import { __testables as characterTestables } from "./characters";
import {
  getMythicPlusRunAttemptId,
  getMythicPlusRunCanonicalKey,
  getMythicPlusRunSortValue,
  shouldReplaceMythicPlusRun,
} from "./mythicPlus";

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

type ProjectedRun = TestRun & {
  rowKey: string;
  playedAt: number;
  sortTimestamp: number;
  upgradeCount: number | null;
  scoreIncrease: number | null;
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

function projectRuns(runs: TestRun[]) {
  const deduped = characterTestables.dedupeMythicPlusRuns(runs as any) as TestRun[];
  const recentRuns = characterTestables.buildRecentRuns(deduped as any) as ProjectedRun[];
  const summary = characterTestables.buildMythicPlusSummary(deduped as any, null) as {
    overall: {
      totalRuns: number;
      totalAttempts?: number;
      completedRuns: number;
      abandonedRuns?: number;
      activeRuns?: number;
      timedRuns: number;
    };
  };
  return { deduped, recentRuns, summary };
}

function assertRecentRunsSortAndDisplayAlignment(recentRuns: ProjectedRun[]) {
  const rowKeys = new Set<string>();

  for (const run of recentRuns) {
    assert.equal(run.playedAt, run.sortTimestamp);
    assert.equal(run.sortTimestamp, getMythicPlusRunSortValue(run as any));
    assert.equal(typeof run.rowKey, "string");
    assert.notEqual(run.rowKey.trim(), "");
    assert.equal(rowKeys.has(run.rowKey), false);
    rowKeys.add(run.rowKey);
  }

  for (let index = 1; index < recentRuns.length; index += 1) {
    assert.ok(recentRuns[index - 1]!.sortTimestamp >= recentRuns[index]!.sortTimestamp);
  }
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

  it("does not treat synthetic attempt IDs with startDate=0 as authoritative", () => {
    const run = makeRun({
      attemptId: "attempt|17|560|15|0",
      fingerprint: "aid|attempt|17|560|15|0",
      seasonID: 17,
      mapChallengeModeID: 560,
      level: 15,
      startDate: 0,
      completedAt: 700000,
      status: "completed",
      observedAt: 700030,
    });

    assert.equal(getMythicPlusRunAttemptId(run as any), null);
    assert.equal(getMythicPlusRunCanonicalKey(run as any), "run|17|560|15|700000");
  });

  it("merges scoreless startDate=0 completion with scored +3600 history row", () => {
    const lookups = makeLookups();
    const scorelessCompletion = makeRun({
      fingerprint: "aid|attempt|17|557|15|0",
      attemptId: "attempt|17|557|15|0",
      seasonID: 17,
      mapChallengeModeID: 557,
      mapName: "Windrunner Spire",
      level: 15,
      startDate: 0,
      completedAt: 1_775_871_828,
      endedAt: 1_775_871_828,
      abandonedAt: 1_775_871_828,
      durationMs: 1_809_183,
      completed: true,
      completedInTime: true,
      status: "completed",
      observedAt: 1_775_870_056,
      members: [
        { name: "Bavaryâ", realm: "Silvermoon", role: "tank", classTag: "PALADIN" },
        { name: "Rampager", realm: "Blackhand", role: "dps", classTag: "EVOKER" },
      ],
    });
    ingestTestables.registerRunLookups(lookups, scorelessCompletion as any);

    const scoredHistory = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "17|557|15|1775868228",
      seasonID: 17,
      mapChallengeModeID: 557,
      mapName: "Windrunner Spire",
      level: 15,
      completedAt: 1_775_868_228,
      endedAt: 1_775_868_228,
      durationMs: 1_809_000,
      runScore: 413,
      completed: true,
      completedInTime: true,
      status: "completed",
      observedAt: 1_775_871_880,
    } as any);

    const matched = ingestTestables.findMatchingExistingRunByIdentity(lookups, scoredHistory);
    assert.equal(matched?._id, scorelessCompletion._id);
  });

  it("query-time dedupe collapses scoreless+scored legacy-shift pair into one recent row", () => {
    const scorelessCompletion = makeRun({
      fingerprint: "aid|attempt|17|557|15|0",
      attemptId: "attempt|17|557|15|0",
      seasonID: 17,
      mapChallengeModeID: 557,
      mapName: "Windrunner Spire",
      level: 15,
      startDate: 0,
      completedAt: 1_775_871_828,
      endedAt: 1_775_871_828,
      abandonedAt: 1_775_871_828,
      durationMs: 1_809_183,
      completed: true,
      completedInTime: true,
      status: "completed",
      observedAt: 1_775_870_056,
      members: [
        { name: "Bavaryâ", realm: "Silvermoon", role: "tank", classTag: "PALADIN" },
        { name: "Rampager", realm: "Blackhand", role: "dps", classTag: "EVOKER" },
      ],
    });
    const scoredHistory = makeRun({
      fingerprint: "17|557|15|1775868228",
      seasonID: 17,
      mapChallengeModeID: 557,
      mapName: "Windrunner Spire",
      level: 15,
      completedAt: 1_775_868_228,
      endedAt: 1_775_868_228,
      durationMs: 1_809_000,
      runScore: 413,
      completed: true,
      completedInTime: true,
      status: "completed",
      observedAt: 1_775_871_880,
    });

    const deduped = characterTestables.dedupeMythicPlusRuns(
      [scorelessCompletion as any, scoredHistory as any],
    ) as TestRun[];

    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.runScore, 413);
    assert.equal(deduped[0]?.members?.length, 2);
  });

  it("stale recovery matches existing active attempts and transitions lifecycle to abandoned", () => {
    const lookups = makeLookups();
    const active = makeRun({
      fingerprint: "attempt|s3|402|10|250000",
      attemptId: "attempt|s3|402|10|250000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 10,
      startDate: 250000,
      status: "active",
      observedAt: 250015,
    });
    ingestTestables.registerRunLookups(lookups, active as any);

    const staleRecoveryIncoming = ingestTestables.mergeMythicPlusRunData(undefined, {
      fingerprint: "legacy-stale-recovery",
      attemptId: "attempt|s3|402|10|250000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 10,
      status: "abandoned",
      abandonReason: "stale_recovery",
      abandonedAt: 251120,
      endedAt: 251120,
      observedAt: 250300,
    } as any);

    const matched = ingestTestables.findMatchingExistingRunByIdentity(lookups, staleRecoveryIncoming);
    assert.equal(matched?._id, active._id);

    const merged = ingestTestables.mergeMythicPlusRunData(active as any, staleRecoveryIncoming);
    assert.equal(merged.status, "abandoned");
    assert.equal(merged.abandonReason, "stale_recovery");
    assert.equal(merged.abandonedAt, 251120);
    assert.equal(merged.endedAt, 251120);
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

  it("narrow +3600 legacy pair merges with tiny timing jitter when core identity is the same", () => {
    const lookups = makeLookups();
    const existing = makeRun({
      fingerprint: "legacy-a",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 14,
      completedAt: 500000,
      durationMs: 1_628_000,
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
      completedAt: 503637,
      durationMs: 1_628_625,
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

  it("upload gating prefers newer terminal timestamp even when observedAt is older", () => {
    const current = makeRun({
      fingerprint: "attempt|s3|402|13|700000",
      attemptId: "attempt|s3|402|13|700000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 13,
      startDate: 700000,
      status: "active",
      observedAt: 701200,
    });

    const candidate = makeRun({
      fingerprint: "legacy-terminal",
      attemptId: "attempt|s3|402|13|700000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 13,
      status: "completed",
      completedAt: 701860,
      durationMs: 1_860_000,
      runScore: 280.5,
      observedAt: 700300,
    });

    assert.equal(shouldReplaceMythicPlusRun(current as any, candidate as any), true);

    const merged = ingestTestables.mergeMythicPlusRunData(current as any, candidate as any);
    assert.equal(merged.status, "completed");
    assert.equal(merged.completedAt, 701860);
    assert.equal(merged.endedAt, 701860);
  });

  it("cross-region same name-realm characters stay isolated by lookup scope", () => {
    const baseRun = {
      fingerprint: "attempt|s3|402|8|750000",
      attemptId: "attempt|s3|402|8|750000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 8,
      startDate: 750000,
      status: "active" as const,
    };

    const usLookups = makeLookups();
    const euLookups = makeLookups();
    const usRun = makeRun({
      ...baseRun,
      _id: "run-us",
      characterId: "char-us",
      observedAt: 750015,
    });
    const euRun = makeRun({
      ...baseRun,
      _id: "run-eu",
      characterId: "char-eu",
      observedAt: 750025,
    });

    ingestTestables.registerRunLookups(usLookups, usRun as any);
    ingestTestables.registerRunLookups(euLookups, euRun as any);

    const incoming = ingestTestables.mergeMythicPlusRunData(undefined, {
      ...baseRun,
      fingerprint: "cross-region-test",
      status: "completed",
      completedAt: 751720,
      durationMs: 1_720_000,
      runScore: 180,
      observedAt: 751740,
    } as any);

    assert.equal(ingestTestables.findMatchingExistingRunByIdentity(usLookups, incoming)?._id, "run-us");
    assert.equal(ingestTestables.findMatchingExistingRunByIdentity(euLookups, incoming)?._id, "run-eu");
  });
});

describe("Mythic+ recent-runs fixture matrix", () => {
  const fixtureCases: Array<{
    name: string;
    runs: TestRun[];
    dedupedCount: number;
    playedAtOrder: number[];
    latestStatus: "active" | "completed" | "abandoned";
  }> = [
    {
      name: "old-only payload",
      runs: [
        makeRun({
          fingerprint: "legacy-old-only",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 10,
          completedAt: 800000,
          durationMs: 1_800_000,
          runScore: 210,
          status: "completed",
          observedAt: 803600,
        }),
      ],
      dedupedCount: 1,
      playedAtOrder: [803600],
      latestStatus: "completed",
    },
    {
      name: "new-only payload",
      runs: [
        makeRun({
          fingerprint: "attempt|s3|402|12|900000",
          attemptId: "attempt|s3|402|12|900000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 12,
          startDate: 900000,
          completedAt: 901650,
          endedAt: 901650,
          durationMs: 1_650_000,
          runScore: 250.2,
          status: "completed",
          observedAt: 901670,
        }),
      ],
      dedupedCount: 1,
      playedAtOrder: [901650],
      latestStatus: "completed",
    },
    {
      name: "mixed old/new same run",
      runs: [
        makeRun({
          fingerprint: "attempt|s3|402|11|920000",
          attemptId: "attempt|s3|402|11|920000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 11,
          startDate: 920000,
          status: "active",
          observedAt: 920010,
        }),
        makeRun({
          fingerprint: "legacy-mixed",
          attemptId: "attempt|s3|402|11|920000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 11,
          completedAt: 921620,
          durationMs: 1_620_000,
          runScore: 201.4,
          status: "completed",
          observedAt: 921640,
        }),
      ],
      dedupedCount: 1,
      playedAtOrder: [921620],
      latestStatus: "completed",
    },
    {
      name: "active -> completed",
      runs: [
        makeRun({
          fingerprint: "attempt|s3|402|13|925000",
          attemptId: "attempt|s3|402|13|925000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 13,
          startDate: 925000,
          status: "active",
          observedAt: 925020,
        }),
        makeRun({
          fingerprint: "legacy-active-complete",
          attemptId: "attempt|s3|402|13|925000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 13,
          completedAt: 926790,
          endedAt: 926790,
          durationMs: 1_790_000,
          runScore: 278.3,
          status: "completed",
          observedAt: 926810,
        }),
      ],
      dedupedCount: 1,
      playedAtOrder: [926790],
      latestStatus: "completed",
    },
    {
      name: "active -> abandoned",
      runs: [
        makeRun({
          fingerprint: "attempt|s3|402|9|927000",
          attemptId: "attempt|s3|402|9|927000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 9,
          startDate: 927000,
          status: "active",
          observedAt: 927025,
        }),
        makeRun({
          fingerprint: "legacy-active-abandon",
          attemptId: "attempt|s3|402|9|927000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 9,
          abandonedAt: 928110,
          endedAt: 928110,
          status: "abandoned",
          abandonReason: "left_instance",
          observedAt: 928130,
        }),
      ],
      dedupedCount: 1,
      playedAtOrder: [928110],
      latestStatus: "abandoned",
    },
    {
      name: "stale recovery",
      runs: [
        makeRun({
          fingerprint: "attempt|s3|402|10|928500",
          attemptId: "attempt|s3|402|10|928500",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 10,
          startDate: 928500,
          status: "active",
          observedAt: 928540,
        }),
        makeRun({
          fingerprint: "legacy-stale-recovery-case",
          attemptId: "attempt|s3|402|10|928500",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 10,
          abandonedAt: 929640,
          endedAt: 929640,
          status: "abandoned",
          abandonReason: "stale_recovery",
          observedAt: 929660,
        }),
      ],
      dedupedCount: 1,
      playedAtOrder: [929640],
      latestStatus: "abandoned",
    },
    {
      name: "true +3600 DST duplicate pair",
      runs: [
        makeRun({
          fingerprint: "attempt|s3|402|14|929000",
          attemptId: "attempt|s3|402|14|929000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 14,
          startDate: 929000,
          completedAt: 930800,
          endedAt: 930800,
          durationMs: 1_800_000,
          runScore: 312.8,
          status: "completed",
          observedAt: 930820,
        }),
        makeRun({
          fingerprint: "legacy-dst-shifted",
          attemptId: "attempt|s3|402|14|929000",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 14,
          startDate: 929000,
          completedAt: 934400,
          endedAt: 934400,
          durationMs: 1_800_000,
          runScore: 312.8,
          status: "completed",
          observedAt: 934420,
        }),
      ],
      dedupedCount: 1,
      playedAtOrder: [934400],
      latestStatus: "completed",
    },
    {
      name: "same-map same-level distinct runs stay separate",
      runs: [
        makeRun({
          fingerprint: "legacy-distinct-a",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 12,
          completedAt: 930000,
          durationMs: 1_650_000,
          runScore: 251,
          status: "completed",
          observedAt: 930020,
        }),
        makeRun({
          fingerprint: "legacy-distinct-b",
          seasonID: 3,
          mapChallengeModeID: 402,
          level: 12,
          completedAt: 931500,
          durationMs: 1_700_000,
          runScore: 252,
          status: "completed",
          observedAt: 931520,
        }),
      ],
      dedupedCount: 2,
      playedAtOrder: [931500, 930000],
      latestStatus: "completed",
    },
  ];

  for (const fixtureCase of fixtureCases) {
    it(`fixture: ${fixtureCase.name}`, () => {
      const { deduped, recentRuns } = projectRuns(fixtureCase.runs);

      assert.equal(deduped.length, fixtureCase.dedupedCount);
      assert.deepEqual(
        recentRuns.map((run) => run.playedAt),
        fixtureCase.playedAtOrder,
      );
      assert.equal(recentRuns[0]?.status, fixtureCase.latestStatus);
      assertRecentRunsSortAndDisplayAlignment(recentRuns);
    });
  }

  it("recent-runs row key prefers backend _id and falls back to strict identity composite", () => {
    const withId = makeRun({
      _id: "run-stable-id",
      fingerprint: "attempt|s3|402|8|933000",
      attemptId: "attempt|s3|402|8|933000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 8,
      startDate: 933000,
      completedAt: 934500,
      durationMs: 1_500_000,
      status: "completed",
      observedAt: 934520,
    });
    const withoutId = makeRun({
      _id: "",
      fingerprint: "legacy-no-id",
      attemptId: "attempt|s3|402|7|935000",
      canonicalKey: "aid|attempt|s3|402|7|935000",
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 7,
      startDate: 935000,
      completedAt: 936700,
      durationMs: 1_700_000,
      status: "completed",
      observedAt: 936720,
    });

    const { recentRuns } = projectRuns([withId, withoutId]);
    const keyedWithId = recentRuns.find((run) => run._id === "run-stable-id");
    const keyedWithoutId = recentRuns.find((run) => run._id === "");

    assert.equal(keyedWithId?.rowKey, "run-stable-id");
    assert.equal(
      keyedWithoutId?.rowKey,
      "aid:attempt|s3|402|7|935000|ck:aid|attempt|s3|402|7|935000|fp:legacy-no-id|936700",
    );
  });

  it("partial members + full members merge into one enriched roster", () => {
    const attemptId = "attempt|s3|402|10|940000";
    const partialMembers = makeRun({
      fingerprint: attemptId,
      attemptId,
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 10,
      startDate: 940000,
      completedAt: 941720,
      durationMs: 1_720_000,
      runScore: 220,
      status: "completed",
      observedAt: 941740,
      members: [
        { name: "Tanky" },
        { name: "Healz" },
        { name: "Dpsy" },
        { name: "Dpsz" },
        { name: "Dpsx" },
      ],
    });
    const fullMembers = makeRun({
      fingerprint: attemptId,
      attemptId,
      seasonID: 3,
      mapChallengeModeID: 402,
      level: 10,
      startDate: 940000,
      completedAt: 941720,
      durationMs: 1_720_000,
      runScore: 220,
      status: "completed",
      observedAt: 941760,
      members: [
        { name: "Tanky", realm: "Area 52", classTag: "warrior", role: "tank" },
        { name: "Healz", realm: "Area 52", classTag: "priest", role: "healer" },
        { name: "Dpsy", realm: "Stormrage", classTag: "mage", role: "dps" },
        { name: "Dpsz", realm: "Illidan", classTag: "warlock", role: "dps" },
        { name: "Dpsx", realm: "Tichondrius", classTag: "hunter", role: "dps" },
      ],
    });

    const { deduped } = projectRuns([partialMembers, fullMembers]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.members?.length, 5);

    const tank = deduped[0]?.members?.find((member) => member.name === "Tanky");
    assert.equal(tank?.realm, "Area 52");
    assert.equal(tank?.classTag, "warrior");
    assert.equal(tank?.role, "tank");
  });

  it("summary semantics: active excluded from completed/timed, abandoned counted in attempts", () => {
    const runs = [
      makeRun({
        fingerprint: "attempt|s3|402|13|950000",
        attemptId: "attempt|s3|402|13|950000",
        seasonID: 3,
        mapChallengeModeID: 402,
        level: 13,
        startDate: 950000,
        status: "active",
        observedAt: 950020,
      }),
      makeRun({
        fingerprint: "attempt|s3|402|12|951000",
        attemptId: "attempt|s3|402|12|951000",
        seasonID: 3,
        mapChallengeModeID: 402,
        level: 12,
        startDate: 951000,
        completedAt: 952500,
        durationMs: 1_500_000,
        runScore: 250,
        status: "completed",
        observedAt: 952520,
      }),
      makeRun({
        fingerprint: "attempt|s3|402|11|953000",
        attemptId: "attempt|s3|402|11|953000",
        seasonID: 3,
        mapChallengeModeID: 402,
        level: 11,
        startDate: 953000,
        completedAt: 955400,
        durationMs: 2_400_000,
        runScore: 220,
        status: "completed",
        observedAt: 955420,
      }),
      makeRun({
        fingerprint: "attempt|s3|402|10|956000",
        attemptId: "attempt|s3|402|10|956000",
        seasonID: 3,
        mapChallengeModeID: 402,
        level: 10,
        startDate: 956000,
        abandonedAt: 956900,
        endedAt: 956900,
        status: "abandoned",
        abandonReason: "left_instance",
        observedAt: 956940,
      }),
    ];

    const { recentRuns, summary } = projectRuns(runs);
    assert.equal(summary.overall.totalRuns, 3);
    assert.equal(summary.overall.totalAttempts, 3);
    assert.equal(summary.overall.completedRuns, 2);
    assert.equal(summary.overall.abandonedRuns, 1);
    assert.equal(summary.overall.activeRuns, 1);
    assert.equal(summary.overall.timedRuns, 1);

    const activeRuns = recentRuns.filter((run) => run.status === "active");
    assert.equal(activeRuns.length, 1);
  });
});

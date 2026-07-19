import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canUseMythicPlusRunCompatibilityAliasMatch,
  dedupeMythicPlusRuns,
  getMythicPlusRunAttemptId,
  getMythicPlusRunCanonicalKey,
  getMythicPlusRunLifecycleStatus,
  mergeMythicPlusRunMembers,
  type MythicPlusRunDocument,
} from "./index";

const party = [
  { name: "Tank", realm: "Tarren Mill", role: "tank" as const, classTag: "WARRIOR" },
  { name: "Healer", realm: "Draenor", role: "healer" as const, classTag: "PRIEST" },
  { name: "One", realm: "Draenor", role: "dps" as const, classTag: "MAGE" },
  { name: "Two", realm: "Draenor", role: "dps" as const, classTag: "ROGUE" },
  { name: "Three", realm: "Draenor", role: "dps" as const, classTag: "HUNTER" },
];

describe("cross-runtime Mythic+ identity contract", () => {
  it("derives the same stable identity from API-shaped and desktop-shaped runs", () => {
    const startDate = 1_800_000_000;
    const apiRun: MythicPlusRunDocument = {
      seasonID: 14,
      mapChallengeModeID: 558,
      level: 10,
      startDate,
      observedAt: startDate,
    };
    const desktopRun = {
      fingerprint: "",
      observedAt: startDate,
      seasonID: 14,
      mapChallengeModeID: 558,
      level: 10,
      startDate,
    } satisfies MythicPlusRunDocument;

    const expectedAttemptId = `attempt|14|558|10|${startDate}`;
    assert.equal(getMythicPlusRunAttemptId(apiRun), expectedAttemptId);
    assert.equal(getMythicPlusRunAttemptId(desktopRun), expectedAttemptId);
    assert.equal(getMythicPlusRunCanonicalKey(apiRun), `aid|${expectedAttemptId}`);
    assert.equal(getMythicPlusRunCanonicalKey(desktopRun), `aid|${expectedAttemptId}`);
  });

  it("merges an addon active attempt with its Battle.net completion without losing identity", () => {
    const startDate = 1_800_000_000;
    const attemptId = `attempt|14|558|10|${startDate}`;
    const activeRun: MythicPlusRunDocument = {
      fingerprint: attemptId,
      attemptId,
      observedAt: startDate,
      startDate,
      seasonID: 14,
      mapChallengeModeID: 558,
      mapName: "Magisters' Terrace",
      level: 10,
      status: "active",
      members: party.map(({ name, role }) => ({ name, role })),
    };
    const completedRun: MythicPlusRunDocument = {
      fingerprint: "legacy-history-row",
      observedAt: startDate + 1_802,
      completedAt: startDate + 1_800,
      endedAt: startDate + 1_800,
      seasonID: 14,
      mapChallengeModeID: 558,
      mapName: "Magisters' Terrace",
      level: 10,
      status: "completed",
      completed: true,
      completedInTime: true,
      durationMs: 1_800_000,
      runScore: 123.4,
      members: party,
    };

    assert.equal(canUseMythicPlusRunCompatibilityAliasMatch(activeRun, completedRun), true);
    const [merged] = dedupeMythicPlusRuns([activeRun, completedRun]);
    assert.ok(merged);
    assert.equal(getMythicPlusRunLifecycleStatus(merged), "completed");
    assert.equal(merged.attemptId, attemptId);
    assert.equal(merged.canonicalKey, `aid|${attemptId}`);
    assert.equal(merged.runScore, 123.4);
    assert.equal(merged.members?.length, 5);
    assert.equal(merged.members?.[0]?.realm, "Tarren Mill");
  });

  it("keeps member enrichment deterministic across partial desktop captures", () => {
    const merged = mergeMythicPlusRunMembers(
      [
        { name: "Tank", role: "tank" },
        { name: "Mage", realm: "Draenor", role: "dps" },
      ],
      [
        { name: "Tank", realm: "Tarren Mill", classTag: "WARRIOR" },
        { name: "Mage", realm: "Draenor", classTag: "MAGE" },
      ],
    );

    assert.deepEqual(merged, [
      { name: "Tank", realm: "Tarren Mill", classTag: "WARRIOR", role: "tank" },
      { name: "Mage", realm: "Draenor", classTag: "MAGE", role: "dps" },
    ]);
  });

  it("does not collapse runs whose core dungeon identity differs", () => {
    const first: MythicPlusRunDocument = {
      observedAt: 1_800_000_000,
      startDate: 1_800_000_000,
      seasonID: 14,
      mapChallengeModeID: 558,
      level: 10,
    };
    const second: MythicPlusRunDocument = {
      observedAt: 1_800_000_000,
      startDate: 1_800_000_000,
      seasonID: 14,
      mapChallengeModeID: 559,
      level: 10,
    };

    assert.equal(canUseMythicPlusRunCompatibilityAliasMatch(first, second), false);
    assert.equal(dedupeMythicPlusRuns([first, second]).length, 2);
  });
});

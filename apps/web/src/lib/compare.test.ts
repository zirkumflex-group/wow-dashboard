import assert from "node:assert/strict";
import test from "node:test";

import { buildTimelineData, type CharacterTimeline } from "./compare";

function utcSeconds(year: number, month: number, day: number, hour = 0) {
  return Math.floor(Date.UTC(year, month - 1, day, hour) / 1000);
}

test("buildTimelineData aligns rows to UTC days and carries the last known value", () => {
  const timelines: CharacterTimeline[] = [
    {
      key: "mage",
      name: "Mage",
      snapshots: [
        {
          takenAt: utcSeconds(2026, 7, 11, 18),
          itemLevel: 630,
          mythicPlusScore: 100,
          playtimeSeconds: 3600,
        },
        {
          takenAt: utcSeconds(2026, 7, 15, 9),
          itemLevel: 635,
          mythicPlusScore: 250,
          playtimeSeconds: 7200,
        },
      ],
    },
  ];

  const rows = buildTimelineData(timelines, "mythicPlusScore", "7d", utcSeconds(2026, 7, 19, 12));

  assert.equal(rows[0]?.date, utcSeconds(2026, 7, 12));
  assert.equal(rows[0]?.mage, 100);
  assert.equal(rows.at(-1)?.date, utcSeconds(2026, 7, 19));
  assert.equal(rows.at(-1)?.mage, 250);
});

test("buildTimelineData preserves a missing metric as a chart gap", () => {
  const timelines: CharacterTimeline[] = [
    {
      key: "warrior",
      name: "Warrior",
      snapshots: [
        {
          takenAt: utcSeconds(2026, 7, 18),
          itemLevel: 640,
          mythicPlusScore: 300,
          playtimeSeconds: 10_800,
        },
      ],
    },
  ];

  const rows = buildTimelineData(timelines, "keystoneLevel", "7d", utcSeconds(2026, 7, 19));

  assert.equal(rows.at(-1)?.warrior, null);
});

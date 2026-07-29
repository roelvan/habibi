import test from "node:test";
import assert from "node:assert/strict";

import {
  BackupError,
  HabitTrackerModel,
  createYearLayout,
  decodeBackup,
  encodeBackup,
} from "../model.mjs";

const HABIT_ID = "123E4567-E89B-12D3-A456-426614174000";
const SECOND_ID = "223E4567-E89B-42D3-B456-426614174001";
const JUL_13_2026 = new Date(2026, 6, 13, 12);

test("2026 uses the same Monday-first layout as SwiftUI", () => {
  const layout = createYearLayout(2026);
  assert.equal(layout.dayCount, 365);
  assert.equal(layout.leadingEmpty, 3);
  assert.equal(layout.weekCount, 53);
  assert.equal(layout.monthLabels[0], "Jan");
  assert.equal(layout.monthLabels[26], "Jul");
  assert.equal(layout.dayIndex(0, 2), null);
  assert.equal(layout.dayIndex(0, 3), 0);
  assert.equal(layout.dateLabel(193), "Jul 13");
});

test("current Swift backup dictionaries decode and retain counts", () => {
  const backup = JSON.stringify({
    habits: [{ id: HABIT_ID, name: "Abs" }],
    counts: [HABIT_ID, { 2026: { 5: 1, 10: 3 } }],
    activeHabitID: HABIT_ID,
    years: [2026, 2027],
  });
  const state = decodeBackup(backup, 2026);
  assert.equal(state.counts[HABIT_ID][2026][5], 1);
  assert.equal(state.counts[HABIT_ID][2026][10], 3);
  assert.deepEqual(state.years, [2026, 2027]);
});

test("v1 Swift completion sets migrate to counts", () => {
  const backup = JSON.stringify({
    habits: [{ id: HABIT_ID, name: "Abs" }],
    completions: [HABIT_ID, { 2026: [5, 10] }],
    activeHabitID: HABIT_ID,
  });
  const state = decodeBackup(backup, 2026);
  assert.deepEqual(state.counts[HABIT_ID][2026], { 5: 1, 10: 1 });
  assert.deepEqual(state.years, [2026]);
});

test("web export remains Swift JSONDecoder compatible", () => {
  const state = {
    habits: [
      { id: HABIT_ID, name: "Abs" },
      { id: SECOND_ID, name: "Read" },
    ],
    counts: {
      [HABIT_ID]: { 2026: { 10: 2 } },
      [SECOND_ID]: { 2026: { 11: 1 } },
    },
    activeHabitID: SECOND_ID,
    years: [2026],
  };
  const encoded = encodeBackup(state);
  const raw = JSON.parse(encoded);
  assert.ok(Array.isArray(raw.counts));
  assert.equal(raw.counts.length, 4);
  assert.deepEqual(decodeBackup(encoded, 2026), state);
});

test("increment, clear, habit selection, and year selection are isolated", () => {
  const state = {
    habits: [
      { id: HABIT_ID, name: "Abs" },
      { id: SECOND_ID, name: "Read" },
    ],
    counts: {},
    activeHabitID: HABIT_ID,
    years: [2025, 2026],
  };
  const model = new HabitTrackerModel({ state, now: JUL_13_2026 });
  model.increment(10);
  model.increment(10);
  assert.equal(model.count(10), 2);

  model.selectHabit(SECOND_ID);
  assert.equal(model.count(10), 0);
  model.setYear(2025);
  model.increment(364);
  assert.equal(model.stats().lastDoneDaysAgo, 194);
  model.clear(364);
  assert.equal(model.count(364), 0);
});

test("stats match the Swift behavior for the current week and year", () => {
  const state = {
    habits: [{ id: HABIT_ID, name: "Abs" }],
    counts: {},
    activeHabitID: HABIT_ID,
    years: [2026],
  };
  const model = new HabitTrackerModel({ state, now: JUL_13_2026 });
  assert.deepEqual(model.stats(), {
    weekDoneTotal: 0,
    yearDoneTotal: 0,
    lastDoneDaysAgo: null,
  });
  model.increment(193);
  model.increment(193);
  model.increment(191);
  assert.deepEqual(model.stats(), {
    weekDoneTotal: 1,
    yearDoneTotal: 2,
    lastDoneDaysAgo: 0,
  });
  model.clear(193);
  assert.deepEqual(model.stats(), {
    weekDoneTotal: 0,
    yearDoneTotal: 1,
    lastDoneDaysAgo: 2,
  });
});

test("invalid imports fail without producing partial state", () => {
  assert.throws(() => decodeBackup("junk", 2026), BackupError);
  assert.throws(
    () =>
      decodeBackup(
        JSON.stringify({
          habits: [{ id: HABIT_ID, name: "Abs" }],
          counts: [HABIT_ID, { 2026: { 999: 1 } }],
        }),
        2026,
      ),
    BackupError,
  );
});

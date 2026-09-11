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
  assert.deepEqual(decodeBackup(encoded, 2026), {
    ...state, habits: state.habits.map((habit) => ({ ...habit, type: "good" })),
  });
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

test("stats total every occurrence for the current week and year", () => {
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
  model.increment(193);
  model.increment(191);
  assert.deepEqual(model.stats(), {
    weekDoneTotal: 3,
    yearDoneTotal: 4,
    lastDoneDaysAgo: 0,
  });
  model.clear(193);
  assert.deepEqual(model.stats(), {
    weekDoneTotal: 0,
    yearDoneTotal: 1,
    lastDoneDaysAgo: 2,
  });
});

test("refreshing the date moves today and stats forward", () => {
  const state = {
    habits: [{ id: HABIT_ID, name: "Abs" }],
    counts: {},
    activeHabitID: HABIT_ID,
    years: [2026],
  };
  const model = new HabitTrackerModel({ state, now: JUL_13_2026 });
  model.increment(193);

  assert.equal(model.refreshCurrentDate(new Date(2026, 6, 14, 12)), true);
  assert.equal(model.todayIndex(), 194);
  assert.deepEqual(model.stats(), {
    weekDoneTotal: 1,
    yearDoneTotal: 1,
    lastDoneDaysAgo: 1,
  });
});

test("refreshing the date follows a new year", () => {
  const state = {
    habits: [{ id: HABIT_ID, name: "Abs" }],
    counts: {},
    activeHabitID: HABIT_ID,
    years: [2026],
  };
  const model = new HabitTrackerModel({
    state,
    now: new Date(2026, 11, 31, 12),
  });
  model.increment(364);

  assert.equal(model.refreshCurrentDate(new Date(2027, 0, 1, 12)), true);
  assert.equal(model.year, 2027);
  assert.deepEqual(model.years, [2026, 2027]);
  assert.equal(model.todayIndex(), 0);
  assert.deepEqual(model.stats(), {
    weekDoneTotal: 0,
    yearDoneTotal: 0,
    lastDoneDaysAgo: 1,
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


test("habit types default to good and survive backup round trips", () => {
  const model = new HabitTrackerModel({ now: JUL_13_2026 });
  assert.ok(model.habits.every((habit) => habit.type === "good"));
  const good = model.addHabit("Read");
  const bad = model.addHabit("Smoke", "bad");
  assert.equal(good.type, "good");
  assert.equal(bad.type, "bad");
  assert.equal(model.setHabitType(good.id, "bad"), true);
  const restored = HabitTrackerModel.fromBackup(model.toBackupJSON());
  assert.equal(restored.habits.find((habit) => habit.id === good.id).type, "bad");
  assert.equal(model.setHabitType(good.id, "unknown"), false);
  const raw = JSON.parse(model.toBackupJSON());
  raw.habits[0].type = "unknown";
  assert.throws(() => decodeBackup(JSON.stringify(raw)), BackupError);
});

test("overview excludes bad habits, puts never first, and considers all past years", () => {
  const model = new HabitTrackerModel({ now: new Date(2026, 0, 2, 12) });
  model.state.habits = [];
  const today = model.addHabit("Today");
  model.increment(1);
  const old = model.addHabit("Old");
  model.state.counts[old.id] = { 2024: { 365: 1 }, 2027: { 0: 1 } };
  const never = model.addHabit("Never");
  model.increment(2); // A future completion does not count as last done.
  model.addHabit("Bad", "bad");
  const active = model.activeHabitID;
  assert.deepEqual(model.neglectedHabits().map(({ id, daysAgo }) => ({ id, daysAgo })), [
    { id: never.id, daysAgo: null },
    { id: old.id, daysAgo: 367 },
    { id: today.id, daysAgo: 0 },
  ]);
  assert.equal(model.activeHabitID, active);
  model.setHabitType(old.id, "bad");
  assert.equal(model.neglectedHabits().length, 2);
});

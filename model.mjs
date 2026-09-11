const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BackupError extends Error {
  constructor(message = "The selected file is not a valid Habibi backup.") {
    super(message);
    this.name = "BackupError";
  }
}

export function daysInYear(year) {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

export function dayIndexForDate(date) {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day - start) / 86_400_000);
}

export function createYearLayout(year) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("Invalid calendar year");
  }

  const dayCount = daysInYear(year);
  const leadingEmpty = (new Date(year, 0, 1).getDay() + 6) % 7;
  const weekCount = Math.ceil((leadingEmpty + dayCount) / 7);
  const monthStartIndices = [];
  const monthLabels = Array(weekCount).fill(null);

  let running = 0;
  for (let month = 0; month < 12; month += 1) {
    monthStartIndices.push(running);
    monthLabels[Math.floor((leadingEmpty + running) / 7)] = MONTHS[month];
    running += new Date(year, month + 1, 0).getDate();
  }

  return {
    year,
    dayCount,
    leadingEmpty,
    weekCount,
    monthLabels,
    dayIndex(week, column) {
      const index = week * 7 + column - leadingEmpty;
      return index >= 0 && index < dayCount ? index : null;
    },
    position(dayIndex) {
      const slot = leadingEmpty + dayIndex;
      return { week: Math.floor(slot / 7), column: slot % 7 };
    },
    dayOfMonth(dayIndex) {
      let month = 11;
      while (monthStartIndices[month] > dayIndex) month -= 1;
      return dayIndex - monthStartIndices[month] + 1;
    },
    monthForDay(dayIndex) {
      let month = 11;
      while (monthStartIndices[month] > dayIndex) month -= 1;
      return month;
    },
    dateLabel(dayIndex) {
      const month = this.monthForDay(dayIndex);
      return `${MONTHS[month]} ${this.dayOfMonth(dayIndex)}`;
    },
  };
}

function createUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
    (
      Number(digit) ^
      (globalThis.crypto.getRandomValues(new Uint8Array(1))[0] &
        (15 >> (Number(digit) / 4)))
    ).toString(16),
  );
}

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackupError();
  }
  return value;
}

function dictionaryEntries(value) {
  if (Array.isArray(value)) {
    if (value.length % 2 !== 0) throw new BackupError();
    const entries = [];
    for (let index = 0; index < value.length; index += 2) {
      entries.push([value[index], value[index + 1]]);
    }
    return entries;
  }
  return Object.entries(assertObject(value));
}

function parseHabits(value) {
  if (!Array.isArray(value) || value.length === 0) throw new BackupError();
  const ids = new Set();
  return value.map((candidate) => {
    const habit = assertObject(candidate);
    if (
      typeof habit.id !== "string" ||
      !UUID_PATTERN.test(habit.id) ||
      typeof habit.name !== "string" ||
      !habit.name.trim() ||
      ids.has(habit.id) ||
      (habit.type !== undefined && !["good", "bad"].includes(habit.type))
    ) {
      throw new BackupError();
    }
    ids.add(habit.id);
    return { id: habit.id, name: habit.name.trim(), type: habit.type ?? "good" };
  });
}

function parseCounts(value, legacy = false) {
  const result = {};
  for (const [habitID, rawYears] of dictionaryEntries(value)) {
    if (typeof habitID !== "string" || !UUID_PATTERN.test(habitID)) {
      throw new BackupError();
    }

    const years = {};
    for (const [yearKey, rawDays] of Object.entries(assertObject(rawYears))) {
      const year = Number(yearKey);
      if (!Number.isInteger(year) || year < 1 || year > 9999) {
        throw new BackupError();
      }

      const days = {};
      if (legacy) {
        if (!Array.isArray(rawDays)) throw new BackupError();
        for (const rawDay of rawDays) {
          if (
            !Number.isInteger(rawDay) ||
            rawDay < 0 ||
            rawDay >= daysInYear(year)
          ) {
            throw new BackupError();
          }
          days[rawDay] = 1;
        }
      } else {
        for (const [dayKey, count] of Object.entries(assertObject(rawDays))) {
          const day = Number(dayKey);
          if (
            !Number.isInteger(day) ||
            day < 0 ||
            day >= daysInYear(year) ||
            !Number.isInteger(count) ||
            count < 1
          ) {
            throw new BackupError();
          }
          days[day] = count;
        }
      }
      years[year] = days;
    }
    result[habitID] = years;
  }
  return result;
}

function normalizeYears(rawYears, currentYear) {
  if (rawYears !== undefined && rawYears !== null && !Array.isArray(rawYears)) {
    throw new BackupError();
  }

  const years = new Set([currentYear]);
  for (const candidate of rawYears ?? []) {
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > 9999) {
      throw new BackupError();
    }
    years.add(candidate);
  }
  return [...years].sort((a, b) => a - b);
}

export function decodeBackup(text, currentYear = new Date().getFullYear()) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError();
  }
  assertObject(raw);

  const habits = parseHabits(raw.habits);
  const isCurrent = Object.prototype.hasOwnProperty.call(raw, "counts");
  const isLegacy = Object.prototype.hasOwnProperty.call(raw, "completions");
  if (!isCurrent && !isLegacy) throw new BackupError();

  const counts = parseCounts(
    isCurrent ? raw.counts : raw.completions,
    !isCurrent,
  );
  const activeHabitID = habits.some((habit) => habit.id === raw.activeHabitID)
    ? raw.activeHabitID
    : habits[0].id;

  return {
    habits,
    counts,
    activeHabitID,
    years: normalizeYears(isCurrent ? raw.years : undefined, currentYear),
  };
}

export function encodeBackup(state) {
  const swiftCounts = [];
  for (const [habitID, years] of Object.entries(state.counts)) {
    swiftCounts.push(habitID, years);
  }

  return JSON.stringify({
    habits: state.habits.map(({ id, name, type = "good" }) => ({ id, name, type })),
    counts: swiftCounts,
    activeHabitID: state.activeHabitID,
    years: [...state.years],
  });
}

export class HabitTrackerModel {
  constructor({ state = null, now = new Date() } = {}) {
    this.now = new Date(now);
    this.currentYear = this.now.getFullYear();
    this.currentDayIndex = dayIndexForDate(this.now);
    this.state =
      state ??
      {
        habits: ["Abs", "Pups", "TT"].map((name) => ({
          id: createUUID(),
          name,
        })),
        counts: {},
        activeHabitID: null,
        years: [this.currentYear],
      };
    for (const habit of this.state.habits) habit.type ??= "good";
    this.state.activeHabitID ??= this.state.habits[0].id;
    this.year = this.currentYear;
    this.layout = createYearLayout(this.year);
  }

  static fromBackup(text, { now = new Date() } = {}) {
    return new HabitTrackerModel({
      state: decodeBackup(text, new Date(now).getFullYear()),
      now,
    });
  }

  get habits() {
    return this.state.habits;
  }

  get years() {
    return this.state.years;
  }

  get activeHabitID() {
    return this.state.activeHabitID;
  }

  get activeHabit() {
    return (
      this.habits.find((habit) => habit.id === this.activeHabitID) ??
      this.habits[0]
    );
  }

  get dayCounts() {
    return this.state.counts[this.activeHabitID]?.[this.year] ?? {};
  }

  count(dayIndex) {
    return this.dayCounts[dayIndex] ?? 0;
  }

  increment(dayIndex) {
    if (
      !Number.isInteger(dayIndex) ||
      dayIndex < 0 ||
      dayIndex >= this.layout.dayCount
    ) {
      return false;
    }
    const habitYears = (this.state.counts[this.activeHabitID] ??= {});
    const days = (habitYears[this.year] ??= {});
    days[dayIndex] = (days[dayIndex] ?? 0) + 1;
    return true;
  }

  clear(dayIndex) {
    const days = this.state.counts[this.activeHabitID]?.[this.year];
    if (!days?.[dayIndex]) return false;
    delete days[dayIndex];
    return true;
  }

  selectHabit(id) {
    if (
      id === this.activeHabitID ||
      !this.habits.some((habit) => habit.id === id)
    ) {
      return false;
    }
    this.state.activeHabitID = id;
    return true;
  }

  setYear(year) {
    if (!this.years.includes(year) || year === this.year) return false;
    this.year = year;
    this.layout = createYearLayout(year);
    return true;
  }

  refreshCurrentDate(now = new Date()) {
    const nextNow = new Date(now);
    const nextCurrentYear = nextNow.getFullYear();
    const nextCurrentDayIndex = dayIndexForDate(nextNow);
    if (
      nextCurrentYear === this.currentYear &&
      nextCurrentDayIndex === this.currentDayIndex
    ) {
      return false;
    }

    const wasShowingCurrentYear = this.year === this.currentYear;
    this.now = nextNow;
    this.currentYear = nextCurrentYear;
    this.currentDayIndex = nextCurrentDayIndex;
    this.state.years = normalizeYears(this.state.years, nextCurrentYear);

    if (wasShowingCurrentYear && this.year !== nextCurrentYear) {
      this.year = nextCurrentYear;
      this.layout = createYearLayout(nextCurrentYear);
    }
    return true;
  }

  addNextYear() {
    const next = Math.max(...this.years) + 1;
    if (next > 9999) return null;
    this.state.years = [...new Set([...this.years, next])].sort(
      (a, b) => a - b,
    );
    return next;
  }

  addHabit(name, type = "good") {
    const trimmed = name.trim();
    if (!trimmed || !["good", "bad"].includes(type)) return null;
    const habit = { id: createUUID(), name: trimmed, type };
    this.habits.push(habit);
    this.state.activeHabitID = habit.id;
    return habit;
  }

  renameHabit(id, name) {
    const trimmed = name.trim();
    const habit = this.habits.find((candidate) => candidate.id === id);
    if (!trimmed || !habit) return false;
    habit.name = trimmed;
    return true;
  }

  deleteHabit(id) {
    const index = this.habits.findIndex((habit) => habit.id === id);
    if (index < 0 || this.habits.length === 1) return false;
    this.habits.splice(index, 1);
    delete this.state.counts[id];
    if (this.activeHabitID === id) {
      this.state.activeHabitID =
        this.habits[Math.min(index, this.habits.length - 1)].id;
    }
    return true;
  }

  todayIndex() {
    return this.year === this.currentYear ? this.currentDayIndex : null;
  }

  setHabitType(id, type) {
    const habit = this.habits.find((candidate) => candidate.id === id);
    if (!habit || !["good", "bad"].includes(type)) return false;
    habit.type = type;
    return true;
  }

  neglectedHabits() {
    return this.habits
      .filter((habit) => habit.type === "good")
      .map((habit) => ({ ...habit, daysAgo: this.stats(habit.id).lastDoneDaysAgo }))
      .sort((a, b) => {
        if (a.daysAgo === b.daysAgo) return a.name.localeCompare(b.name);
        if (a.daysAgo === null) return -1;
        if (b.daysAgo === null) return 1;
        return b.daysAgo - a.daysAgo;
      });
  }

  stats(habitID = this.activeHabitID) {
    const habitYears = this.state.counts[habitID] ?? {};
    const currentDays = habitYears[this.currentYear] ?? {};
    const completions = Object.entries(currentDays)
      .map(([day, count]) => ({ day: Number(day), count }))
      .filter(({ count }) => count > 0);
    const doneDays = completions.map(({ day }) => day);

    const currentLayout = createYearLayout(this.currentYear);
    const weekStart =
      this.currentDayIndex -
      ((currentLayout.leadingEmpty + this.currentDayIndex) % 7);
    const weekDoneTotal = completions
      .filter(({ day }) => day >= weekStart && day <= weekStart + 6)
      .reduce((total, { count }) => total + count, 0);
    const yearDoneTotal = completions.reduce(
      (total, { count }) => total + count,
      0,
    );

    const latest = doneDays
      .filter((day) => day <= this.currentDayIndex)
      .sort((a, b) => b - a)[0];
    let lastDoneDaysAgo = Number.isInteger(latest)
      ? this.currentDayIndex - latest
      : null;

    if (lastDoneDaysAgo === null) {
      let daysAgo = this.currentDayIndex + 1;
      const storedYears = Object.keys(habitYears).map(Number);
      const minYear = storedYears.length ? Math.min(...storedYears) : null;
      for (
        let previousYear = this.currentYear - 1;
        minYear !== null && previousYear >= minYear;
        previousYear -= 1
      ) {
        const previousDays = Object.keys(habitYears[previousYear] ?? {})
          .map(Number)
          .filter((day) => habitYears[previousYear][day] > 0);
        if (previousDays.length) {
          lastDoneDaysAgo =
            daysAgo +
            (daysInYear(previousYear) - 1 - Math.max(...previousDays));
          break;
        }
        daysAgo += daysInYear(previousYear);
      }
    }

    return {
      weekDoneTotal,
      yearDoneTotal,
      lastDoneDaysAgo,
    };
  }

  toBackupJSON() {
    return encodeBackup(this.state);
  }
}

export { MONTHS };

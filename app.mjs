import { icons } from "./lucide-icons.mjs?v=1.14";
import {
  BackupError,
  HabitTrackerModel,
} from "./model.mjs?v=1.14";
import { CompletionAudio } from "./completion-audio.mjs";

const STORAGE_KEY = "habibi-backup-v1";
const CONFETTI_COLORS = [
  "#ec7c57",
  "#f3b84b",
  "#7cad78",
  "#61a7d8",
  "#b980c4",
  "#fff0d2",
];

const ICONS = {
  plus: icons.plus,
  export: icons.upload,
  import: icons.download,
  install: icons.smartphone,
  pencil: icons.pencil,
  trash: icons["trash-2"],
};

class DurableStore {
  constructor() {
    this.fallback = false;
    this.queue = Promise.resolve();
    this.database = this.#open();
  }

  #open() {
    if (!("indexedDB" in globalThis)) {
      this.fallback = true;
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const request = indexedDB.open("habibi", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("state")) {
          database.createObjectStore("state");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.fallback = true;
        resolve(null);
      };
      request.onblocked = () => {
        this.fallback = true;
        resolve(null);
      };
    });
  }

  async load() {
    const database = await this.database;
    if (!database || this.fallback) {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    }

    return new Promise((resolve) => {
      const transaction = database.transaction("state", "readonly");
      const request = transaction.objectStore("state").get(STORAGE_KEY);
      request.onsuccess = () =>
        resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => resolve(null);
    });
  }

  save(backup) {
    this.latest = backup;
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const database = await this.database;
        if (!database || this.fallback) {
          try {
            localStorage.setItem(STORAGE_KEY, this.latest);
          } catch {
            // The in-memory model still remains usable when storage is unavailable.
          }
          return;
        }

        await new Promise((resolve) => {
          const transaction = database.transaction("state", "readwrite");
          transaction.objectStore("state").put(this.latest, STORAGE_KEY);
          transaction.oncomplete = resolve;
          transaction.onerror = resolve;
          transaction.onabort = resolve;
        });
      });
  }
}

class HabibiApp {
  constructor(model, storage) {
    this.model = model;
    this.storage = storage;
    this.longPress = null;
    this.suppressedClickTarget = null;
    this.toastTimer = null;
    this.confettiFrame = null;
    this.persistenceRequested = false;

    this.app = document.querySelector("#app");
    for (const placeholder of document.querySelectorAll("[data-icon]")) {
      placeholder.innerHTML = icons[placeholder.dataset.icon];
    }
    this.yearButton = document.querySelector("#year-button");
    this.yearTitle = document.querySelector("#year-title");
    this.statsLine = document.querySelector("#stats-line");
    this.settingsButton = document.querySelector("#settings-button");
    this.habitPicker = document.querySelector("#habit-picker");
    this.calendarScroll = document.querySelector("#calendar-scroll");
    this.calendarGrid = document.querySelector("#calendar-grid");
    this.popoverLayer = document.querySelector("#popover-layer");
    this.modalLayer = document.querySelector("#modal-layer");
    this.celebrationCanvas = document.querySelector("#celebration-canvas");
    this.completionAudio = new CompletionAudio(
      document.querySelector("#completion-sound"),
    );
    this.importInput = document.querySelector("#import-input");
    this.toastElement = document.querySelector("#toast");

    this.overviewPage = document.querySelector("#overview-page");
    this.#bindEvents();
    this.#updateScale();
    this.renderAll({ scroll: true });
    this.renderPage();
    new ResizeObserver(() => this.#updateScale()).observe(this.app);
  }

  #bindEvents() {
    document.querySelector("#overview-button").addEventListener("click", () => {
      location.hash = "overview";
    });
    document.querySelector("#overview-back").addEventListener("click", () => {
      location.hash = "";
    });
    window.addEventListener("hashchange", () => this.renderPage());
    this.yearButton.addEventListener("click", () => this.showYearMenu());
    this.settingsButton.addEventListener("click", () => this.showSettingsMenu());
    this.habitPicker.addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-action='add-habit']");
      if (addButton) {
        this.showHabitForm();
        return;
      }

      const button = event.target.closest("[data-habit-id]");
      if (!button || this.#consumeSuppressedClick(button)) return;
      if (this.model.selectHabit(button.dataset.habitId)) {
        this.#persist();
        this.renderHabits();
        this.refreshGridCells();
        this.renderStats();
      }
    });

    this.habitPicker.addEventListener("pointerdown", (event) => {
      const button = event.target.closest("[data-habit-id]");
      if (button) {
        this.#beginLongPress(event, button, () =>
          this.showHabitMenu(button.dataset.habitId, button),
        );
      }
    });
    this.habitPicker.addEventListener("pointermove", (event) =>
      this.#moveLongPress(event),
    );
    this.habitPicker.addEventListener("pointerup", () => this.#endLongPress());
    this.habitPicker.addEventListener("pointercancel", () => this.#endLongPress());
    this.habitPicker.addEventListener("contextmenu", (event) => {
      const button = event.target.closest("[data-habit-id]");
      if (!button) return;
      event.preventDefault();
      this.showHabitMenu(button.dataset.habitId, button);
    });

    this.calendarGrid.addEventListener("click", (event) => {
      const cell = event.target.closest(".day-cell");
      if (!cell || this.#consumeSuppressedClick(cell)) return;
      const day = Number(cell.dataset.day);
      const wasEmpty = this.model.count(day) === 0;
      if (this.model.increment(day)) {
        if (wasEmpty) this.#celebrate(cell);
        this.#persist();
        this.updateCell(day);
        this.renderStats();
      }
    });
    this.calendarGrid.addEventListener("pointerdown", (event) => {
      const cell = event.target.closest(".day-cell");
      if (!cell) return;
      this.#beginLongPress(event, cell, () => {
        const day = Number(cell.dataset.day);
        if (this.model.clear(day)) {
          this.#persist();
          this.updateCell(day);
          this.renderStats();
        }
      });
    });
    this.calendarGrid.addEventListener("pointermove", (event) =>
      this.#moveLongPress(event),
    );
    this.calendarGrid.addEventListener("pointerup", (event) =>
      this.#endLongPress(event, { suppressMovedClick: true }),
    );
    this.calendarGrid.addEventListener("pointercancel", () =>
      this.#endLongPress(),
    );
    this.calendarGrid.addEventListener("contextmenu", (event) => {
      const cell = event.target.closest(".day-cell");
      if (!cell) return;
      event.preventDefault();
      const day = Number(cell.dataset.day);
      if (this.model.clear(day)) {
        this.#persist();
        this.updateCell(day);
        this.renderStats();
      }
    });

    this.importInput.addEventListener("change", async () => {
      const [file] = this.importInput.files;
      this.importInput.value = "";
      if (!file) return;
      try {
        const incoming = HabitTrackerModel.fromBackup(await file.text(), {
          now: new Date(),
        });
        this.model = incoming;
        this.#persist();
        this.renderAll({ scroll: true });
        this.toast("Backup imported");
      } catch (error) {
        if (error instanceof BackupError) {
          this.showAlert(
            "Import Failed",
            "The selected file is not a valid Habibi backup.",
          );
          return;
        }
        this.showAlert(
          "Import Failed",
          "Habibi could not read that file. Please try choosing it again.",
        );
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!this.modalLayer.hidden) this.closeModal();
      else this.closePopover();
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.completionAudio.resetAfterBackground();
        this.#refreshCurrentDate();
      }
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) this.completionAudio.resetAfterBackground();
      this.#refreshCurrentDate();
    });
    window.addEventListener("focus", () => this.#refreshCurrentDate());

    document.addEventListener(
      "click",
      () => {
        if (this.persistenceRequested) return;
        this.persistenceRequested = true;
        navigator.storage?.persist?.().catch(() => {});
      },
      { once: true },
    );
  }

  #updateScale() {
    const scale = Math.min(this.app.clientWidth, 430) / 390;
    document.documentElement.style.setProperty("--s", scale.toFixed(5));
    document.documentElement.style.setProperty(
      "--side",
      `${24 * scale}px`,
    );
    document.documentElement.style.setProperty("--gap", `${5 * scale}px`);
    document.documentElement.style.setProperty("--day", `${38 * scale}px`);
    document.documentElement.style.setProperty("--label", `${28 * scale}px`);
    document.documentElement.style.setProperty("--radius", `${10 * scale}px`);
    document.documentElement.style.setProperty("--ring", `${2.5 * scale}px`);
  }

  #beginLongPress(event, target, callback) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.#endLongPress();
    this.longPress = {
      pointerId: event.pointerId,
      target,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      triggered: false,
      timer: window.setTimeout(() => {
        if (!this.longPress || this.longPress.pointerId !== event.pointerId) {
          return;
        }
        this.longPress.triggered = true;
        this.longPress.timer = null;
        callback();
      }, 520),
    };
  }

  #moveLongPress(event) {
    if (!this.longPress || event.pointerId !== this.longPress.pointerId) return;
    if (
      Math.hypot(
        event.clientX - this.longPress.startX,
        event.clientY - this.longPress.startY,
      ) > 12
    ) {
      clearTimeout(this.longPress.timer);
      this.longPress.timer = null;
      this.longPress.moved = true;
    }
  }

  #endLongPress(event = null, { suppressMovedClick = false } = {}) {
    if (!this.longPress) return;
    if (event && event.pointerId !== this.longPress.pointerId) return;
    const { moved, target, triggered } = this.longPress;
    clearTimeout(this.longPress.timer);
    this.longPress = null;
    if (triggered || (suppressMovedClick && moved)) {
      this.suppressedClickTarget = target;
      window.setTimeout(() => {
        if (this.suppressedClickTarget === target) {
          this.suppressedClickTarget = null;
        }
      }, 500);
    }
  }

  #consumeSuppressedClick(target) {
    if (this.suppressedClickTarget !== target) return false;
    this.suppressedClickTarget = null;
    return true;
  }

  #celebrate(cell) {
    this.completionAudio.play();
    navigator.vibrate?.(16);
    this.#launchConfetti(cell);
  }

  #launchConfetti(cell) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    if (this.confettiFrame !== null) {
      cancelAnimationFrame(this.confettiFrame);
      this.confettiFrame = null;
    }

    const canvas = this.celebrationCanvas;
    const canvasRect = canvas.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvasRect.width * pixelRatio);
    canvas.height = Math.round(canvasRect.height * pixelRatio);

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const scale = Math.max(canvasRect.width / 390, 0.8);
    const originX = cellRect.left + cellRect.width / 2 - canvasRect.left;
    const originY = cellRect.top + cellRect.height / 2 - canvasRect.top;
    const pieces = Array.from({ length: 72 }, (_, index) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.25;
      const speed = (5.2 + Math.random() * 5.4) * scale;
      return {
        x: originX,
        y: originY,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        rotation: Math.random() * Math.PI,
        rotationSpeed: (Math.random() - 0.5) * 0.35,
        width: (5 + Math.random() * 5) * scale,
        height: (3 + Math.random() * 4) * scale,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      };
    });

    const startedAt = performance.now();
    let previousFrame = startedAt;
    const draw = (now) => {
      const elapsed = now - startedAt;
      const step = Math.min((now - previousFrame) / (1000 / 60), 2.5);
      previousFrame = now;
      context.clearRect(0, 0, canvasRect.width, canvasRect.height);
      context.globalAlpha = Math.max(
        0,
        Math.min(1, (1_150 - elapsed) / 350),
      );

      for (const piece of pieces) {
        piece.velocityY += 0.2 * scale * step;
        piece.x += piece.velocityX * step;
        piece.y += piece.velocityY * step;
        piece.rotation += piece.rotationSpeed * step;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(
          -piece.width / 2,
          -piece.height / 2,
          piece.width,
          piece.height,
        );
        context.restore();
      }

      if (elapsed < 1_150) {
        this.confettiFrame = requestAnimationFrame(draw);
      } else {
        context.clearRect(0, 0, canvasRect.width, canvasRect.height);
        context.globalAlpha = 1;
        this.confettiFrame = null;
      }
    };

    this.confettiFrame = requestAnimationFrame(draw);
  }

  #persist() {
    this.storage.save(this.model.toBackupJSON());
  }

  #refreshCurrentDate() {
    if (!this.model.refreshCurrentDate()) return;
    this.#persist();
    this.renderTitle();
    this.renderStats();
    this.renderGrid();
    requestAnimationFrame(() => this.scrollToToday());
  }

  renderAll({ scroll = false } = {}) {
    this.renderTitle();
    this.renderStats();
    this.renderHabits();
    this.renderGrid();
    if (!this.overviewPage.hidden) this.renderOverview();
    if (scroll) requestAnimationFrame(() => this.scrollToToday());
  }

  renderPage() {
    const overview = location.hash === "#overview";
    this.closePopover();
    this.overviewPage.hidden = !overview;
    document.querySelector(".header").hidden = overview;
    document.querySelector(".weekday-row").hidden = overview;
    this.calendarScroll.hidden = overview;
    if (overview) {
      this.model.refreshCurrentDate();
      this.renderOverview();
      document.querySelector("#overview-title").focus();
    } else {
      this.renderAll({ scroll: true });
      document.querySelector("#overview-button").focus({ preventScroll: true });
    }
  }

  renderOverview() {
    const list = document.querySelector("#overview-list");
    list.replaceChildren();
    for (const habit of this.model.neglectedHabits()) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const name = document.createElement("span");
      name.textContent = habit.name;
      const lastDone = document.createElement("span");
      lastDone.className = "overview-last-done";
      lastDone.textContent = habit.daysAgo === null ? "Never done"
        : habit.daysAgo === 0 ? "Today"
        : habit.daysAgo === 1 ? "Yesterday" : `${habit.daysAgo} days ago`;
      button.append(name, lastDone);
      button.addEventListener("click", () => {
        this.model.selectHabit(habit.id);
        this.#persist();
        location.hash = "";
      });
      row.append(button);
      list.append(row);
    }
    if (!list.children.length) {
      const empty = document.createElement("li");
      empty.textContent = "No good habits yet. Set a habit’s type to Good to see it here.";
      list.append(empty);
    }
  }

  renderTitle() {
    this.yearTitle.textContent = String(this.model.year);
  }

  renderStats() {
    const { lastDoneDaysAgo, weekDoneTotal, yearDoneTotal } = this.model.stats();
    const lastDone =
      lastDoneDaysAgo === null
        ? "never"
        : lastDoneDaysAgo === 0
          ? "today"
          : lastDoneDaysAgo === 1
            ? "yesterday"
            : `${lastDoneDaysAgo} days ago`;
    const text = `${lastDone} · ${weekDoneTotal} this week · ${yearDoneTotal} this year`;
    this.statsLine.textContent = text;
    this.statsLine.title = text;
  }

  renderHabits() {
    this.habitPicker.replaceChildren();
    this.habitPicker.classList.toggle("many", this.model.habits.length > 3);

    for (const habit of this.model.habits) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "habit-pill";
      button.dataset.habitId = habit.id;
      button.textContent = habit.name;
      button.setAttribute("aria-pressed", String(habit.id === this.model.activeHabitID));
      button.title = `${habit.name} — hold to edit or delete`;
      if (habit.id === this.model.activeHabitID) button.classList.add("active");
      this.habitPicker.append(button);
    }

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "icon-pill";
    addButton.dataset.action = "add-habit";
    addButton.setAttribute("aria-label", "Add habit");
    addButton.innerHTML = ICONS.plus;
    this.habitPicker.append(addButton);
  }

  renderGrid() {
    const fragment = document.createDocumentFragment();
    const today = this.model.todayIndex();

    for (let week = 0; week < this.model.layout.weekCount; week += 1) {
      const row = document.createElement("div");
      row.className = "week-row";
      row.dataset.week = String(week);

      const monthLabel = document.createElement("span");
      monthLabel.className = "month-label";
      monthLabel.textContent = this.model.layout.monthLabels[week] ?? "";
      row.append(monthLabel);

      for (let column = 0; column < 7; column += 1) {
        const day = this.model.layout.dayIndex(week, column);
        if (day === null) {
          const padding = document.createElement("span");
          padding.className = "day-padding";
          row.append(padding);
          continue;
        }

        const cell = document.createElement("div");
        cell.className = "day-cell";
        if (this.model.layout.monthForDay(day) % 2 === 1) cell.classList.add("alternate-month");
        if (column >= 5) cell.classList.add("weekend");
        if (day === today) cell.classList.add("today");
        cell.dataset.day = String(day);
        cell.title = this.model.layout.dateLabel(day);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "day-cell-button";

        const number = document.createElement("span");
        number.className = "day-number";
        number.textContent = String(this.model.layout.dayOfMonth(day));
        button.append(number);
        cell.append(button);
        row.append(cell);
        this.#setCellAppearance(cell, day);
      }
      fragment.append(row);
    }

    this.calendarGrid.replaceChildren(fragment);
  }

  #setCellAppearance(cell, day) {
    const count = this.model.count(day);
    cell.classList.toggle("done", count > 0);
    cell.querySelector(".completion-count")?.remove();
    if (count > 1) {
      const countLabel = document.createElement("span");
      countLabel.className = "completion-count";
      countLabel.textContent = String(count);
      cell.querySelector(".day-cell-button").append(countLabel);
    }
    const status = count === 0 ? "not completed" : `${count} completions`;
    cell.querySelector(".day-cell-button").setAttribute(
      "aria-label",
      `${this.model.layout.dateLabel(day)}, ${status}. Tap to add; hold to clear.`,
    );
  }

  updateCell(day) {
    const cell = this.calendarGrid.querySelector(`[data-day="${day}"]`);
    if (cell) this.#setCellAppearance(cell, day);
  }

  refreshGridCells() {
    for (const cell of this.calendarGrid.querySelectorAll(".day-cell")) {
      this.#setCellAppearance(cell, Number(cell.dataset.day));
    }
  }

  scrollToToday() {
    const today = this.model.todayIndex();
    if (today === null) {
      this.calendarScroll.scrollTo({ top: 0 });
      return;
    }
    this.calendarGrid
      .querySelector(`[data-day="${today}"]`)
      ?.scrollIntoView({ block: "center" });
  }

  showYearMenu() {
    const container = document.createElement("div");
    const label = document.createElement("p");
    label.className = "menu-label";
    label.textContent = "Select year";
    container.append(label);

    for (const year of this.model.years) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      item.dataset.year = String(year);
      const marker = document.createElement("span");
      marker.className = "check-spacer";
      marker.innerHTML = year === this.model.year ? icons.check : "";
      const text = document.createElement("span");
      text.textContent = String(year);
      item.append(marker, text);
      item.addEventListener("click", () => {
        this.closePopover();
        if (!this.model.setYear(year)) return;
        this.renderTitle();
        this.renderGrid();
        requestAnimationFrame(() => this.scrollToToday());
      });
      container.append(item);
    }

    const divider = document.createElement("div");
    divider.className = "menu-divider";
    container.append(divider);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "menu-item accent";
    add.innerHTML = `${ICONS.plus}<span>Add ${Math.max(...this.model.years) + 1}</span>`;
    add.addEventListener("click", () => {
      const next = this.model.addNextYear();
      this.closePopover();
      if (next !== null) {
        this.#persist();
        this.toast(`${next} added`);
      }
    });
    container.append(add);
    this.showPopover(this.yearButton, container, { align: "left" });
    this.yearButton.setAttribute("aria-expanded", "true");
  }

  showSettingsMenu() {
    const container = document.createElement("div");
    const label = document.createElement("p");
    label.className = "menu-label";
    label.textContent = "Your data";
    container.append(label);

    const backup = this.#menuItem("Backup JSON", ICONS.export);
    backup.addEventListener("click", () => {
      this.closePopover();
      this.exportBackup();
    });
    container.append(backup);

    const importItem = this.#menuItem("Import JSON", ICONS.import);
    importItem.addEventListener("click", () => {
      this.closePopover();
      window.setTimeout(() => this.importInput.click(), 0);
    });
    container.append(importItem);

    const divider = document.createElement("div");
    divider.className = "menu-divider";
    container.append(divider);

    const install = this.#menuItem("Install on iPhone", ICONS.install);
    install.addEventListener("click", () => {
      this.closePopover();
      this.showInstallHelp();
    });
    container.append(install);

    this.showPopover(this.settingsButton, container);
    this.settingsButton.setAttribute("aria-expanded", "true");
  }

  #menuItem(label, icon, className = "") {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `menu-item ${className}`.trim();
    item.innerHTML = `${icon}<span></span>`;
    item.querySelector("span").textContent = label;
    return item;
  }

  showHabitMenu(id, anchor) {
    const habit = this.model.habits.find((candidate) => candidate.id === id);
    if (!habit) return;

    const container = document.createElement("div");
    const label = document.createElement("p");
    label.className = "menu-label";
    label.textContent = habit.name;
    container.append(label);

    const rename = this.#menuItem("Edit habit", ICONS.pencil);
    rename.addEventListener("click", () => {
      this.closePopover();
      this.showHabitForm(habit);
    });
    container.append(rename);

    if (this.model.habits.length > 1) {
      const remove = this.#menuItem("Delete", ICONS.trash, "danger");
      remove.addEventListener("click", () => {
        this.closePopover();
        this.confirmDeleteHabit(habit);
      });
      container.append(remove);
    }

    this.showPopover(anchor, container);
  }

  showPopover(anchor, content, { align = "right" } = {}) {
    this.closePopover();
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "popover-dismiss";
    dismiss.setAttribute("aria-label", "Close menu");
    dismiss.addEventListener("click", () => this.closePopover());

    const popover = document.createElement("div");
    popover.className = "popover";
    popover.setAttribute("role", "menu");
    popover.append(content);
    this.popoverLayer.append(dismiss, popover);
    this.popoverLayer.hidden = false;

    const appRect = this.app.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const edge = 10 * (this.app.clientWidth / 390);
    let left =
      align === "left"
        ? anchorRect.left
        : anchorRect.right - popoverRect.width;
    left = Math.max(
      appRect.left + edge,
      Math.min(left, appRect.right - popoverRect.width - edge),
    );
    let top = anchorRect.bottom + 7;
    if (top + popoverRect.height > appRect.bottom - edge) {
      top = anchorRect.top - popoverRect.height - 7;
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.querySelector("button")?.focus({ preventScroll: true });
  }

  closePopover() {
    this.popoverLayer.hidden = true;
    this.popoverLayer.replaceChildren();
    this.yearButton.setAttribute("aria-expanded", "false");
    this.settingsButton.setAttribute("aria-expanded", "false");
  }

  showHabitForm(habit = null) {
    const editing = Boolean(habit);
    const sheet = this.#createSheet();
    const title = document.createElement("h2");
    title.textContent = editing ? "Edit Habit" : "New Habit";
    const copy = document.createElement("p");
    copy.textContent = editing
      ? "Give this habit a name that feels like yours."
      : "What would you like to keep showing up for?";
    const input = document.createElement("input");
    input.className = "text-input";
    input.type = "text";
    input.placeholder = "Habit name";
    input.autocomplete = "off";
    input.maxLength = 40;
    input.value = habit?.name ?? "";

    const typeLabel = document.createElement("label");
    typeLabel.className = "habit-type-label";
    typeLabel.textContent = "Habit type";
    const typeSelect = document.createElement("select");
    typeSelect.className = "text-input";
    typeSelect.innerHTML = '<option value="good">Good</option><option value="bad">Bad</option>';
    typeSelect.value = habit?.type ?? "good";
    typeLabel.append(typeSelect);

    const actions = this.#createActions("Cancel", editing ? "Save" : "Add");
    actions.cancel.addEventListener("click", () => this.closeModal());
    const submit = () => {
      const changed = editing
        ? this.model.renameHabit(habit.id, input.value)
        : this.model.addHabit(input.value, typeSelect.value);
      if (!changed) {
        input.focus();
        return;
      }
      if (editing) this.model.setHabitType(habit.id, typeSelect.value);
      this.#persist();
      this.closeModal();
      this.renderHabits();
      this.renderStats();
      if (!editing) this.refreshGridCells();
    };
    actions.primary.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });

    sheet.append(title, copy, input, typeLabel, actions.element);
    this.openModal(sheet);
    window.setTimeout(() => {
      input.focus();
      if (editing) input.select();
    }, 220);
  }

  confirmDeleteHabit(habit) {
    const sheet = this.#createSheet();
    const title = document.createElement("h2");
    title.textContent = `Delete ${habit.name}?`;
    const copy = document.createElement("p");
    copy.textContent =
      "Every saved completion for this habit will be removed from this device.";
    const actions = this.#createActions("Cancel", "Delete", "danger");
    actions.cancel.addEventListener("click", () => this.closeModal());
    actions.primary.addEventListener("click", () => {
      if (!this.model.deleteHabit(habit.id)) return;
      if (editing) this.model.setHabitType(habit.id, typeSelect.value);
      this.#persist();
      this.closeModal();
      this.renderHabits();
      this.refreshGridCells();
      this.renderStats();
    });
    sheet.append(title, copy, actions.element);
    this.openModal(sheet);
  }

  showInstallHelp() {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    const sheet = this.#createSheet();
    const title = document.createElement("h2");
    title.textContent = standalone ? "Already Installed" : "Install Habibi";
    const copy = document.createElement("p");
    copy.textContent = standalone
      ? "Habibi is running from your Home Screen as a standalone app."
      : "Add Habibi to your iPhone Home Screen for the full-screen app experience.";
    sheet.append(title, copy);

    if (!standalone) {
      const steps = document.createElement("div");
      steps.className = "install-steps";
      [
        "Open this page in Safari.",
        "Tap the Share button in Safari’s toolbar.",
        "Choose “Add to Home Screen,” then tap Add.",
      ].forEach((text, index) => {
        const row = document.createElement("div");
        row.className = "install-step";
        const number = document.createElement("span");
        number.className = "step-number";
        number.textContent = String(index + 1);
        const content = document.createElement("span");
        content.textContent = text;
        row.append(number, content);
        steps.append(row);
      });
      sheet.append(steps);
    }

    const actions = this.#createActions(null, "Done");
    actions.primary.addEventListener("click", () => this.closeModal());
    sheet.append(actions.element);
    this.openModal(sheet);
  }

  showAlert(titleText, message) {
    const sheet = this.#createSheet();
    const title = document.createElement("h2");
    title.textContent = titleText;
    const copy = document.createElement("p");
    copy.textContent = message;
    const actions = this.#createActions(null, "OK");
    actions.primary.addEventListener("click", () => this.closeModal());
    sheet.append(title, copy, actions.element);
    this.openModal(sheet);
  }

  #createSheet() {
    const sheet = document.createElement("section");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    const handle = document.createElement("div");
    handle.className = "sheet-handle";
    sheet.append(handle);
    return sheet;
  }

  #createActions(cancelLabel, primaryLabel, primaryStyle = "primary") {
    const element = document.createElement("div");
    element.className = "sheet-actions";
    let cancel = null;
    if (cancelLabel) {
      cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "sheet-button";
      cancel.textContent = cancelLabel;
      element.append(cancel);
    }
    const primary = document.createElement("button");
    primary.type = "button";
    primary.className = `sheet-button ${primaryStyle}`;
    primary.textContent = primaryLabel;
    element.append(primary);
    return { element, cancel, primary };
  }

  openModal(sheet) {
    this.closePopover();
    this.modalLayer.replaceChildren(sheet);
    this.modalLayer.hidden = false;
  }

  closeModal() {
    this.modalLayer.hidden = true;
    this.modalLayer.replaceChildren();
  }

  async exportBackup() {
    const contents = this.model.toBackupJSON();
    const filename = `Habibi Backup ${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([contents], filename, { type: "application/json" });

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          files: [file],
          title: "Habibi Backup",
        });
        this.toast("Backup ready");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    this.toast("Backup downloaded");
  }

  toast(message) {
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add("visible");
    this.toastTimer = window.setTimeout(
      () => this.toastElement.classList.remove("visible"),
      2_000,
    );
  }
}

async function start() {
  const storage = new DurableStore();
  const saved = await storage.load();
  let model;
  try {
    model = saved
      ? HabitTrackerModel.fromBackup(saved, { now: new Date() })
      : new HabitTrackerModel();
  } catch {
    model = new HabitTrackerModel();
  }

  const app = new HabibiApp(model, storage);
  if (!saved) storage.save(model.toBackupJSON());
  globalThis.__habibi = app;

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

start();

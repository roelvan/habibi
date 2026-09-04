const RESUME_TIMEOUT_MS = 180;

export class CompletionAudio {
  constructor(
    element,
    {
      AudioContextClass =
        globalThis.AudioContext ?? globalThis.webkitAudioContext,
      fetchFn = globalThis.fetch?.bind(globalThis),
      setTimer = globalThis.setTimeout?.bind(globalThis),
      clearTimer = globalThis.clearTimeout?.bind(globalThis),
    } = {},
  ) {
    this.element = element;
    this.AudioContextClass = AudioContextClass;
    this.fetchFn = fetchFn;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.context = null;
    this.buffer = null;
    this.encodedAudio = null;
    this.activeSource = null;
    this.resumeTimer = null;
    this.primePromise = null;
    this.generation = 0;

    void this.prime();
  }

  prime() {
    if (!this.AudioContextClass || !this.fetchFn) return Promise.resolve(false);
    if (this.buffer && this.context?.state !== "closed") {
      return Promise.resolve(true);
    }
    if (this.primePromise) return this.primePromise;

    const generation = this.generation;
    this.primePromise = this.#loadAndDecode(generation)
      .catch(() => false)
      .finally(() => {
        if (generation === this.generation) this.primePromise = null;
      });
    return this.primePromise;
  }

  play() {
    const context = this.#ensureContext();
    if (!context || !this.buffer) {
      this.#playElement();
      void this.prime();
      return "element";
    }

    try {
      this.#stopSource(this.activeSource);

      const source = context.createBufferSource();
      source.buffer = this.buffer;
      source.connect(context.destination);
      source.addEventListener?.("ended", () => {
        if (this.activeSource === source) this.activeSource = null;
        source.disconnect?.();
      });
      this.activeSource = source;

      // Starting and resuming synchronously keeps both calls inside the tap's
      // user-activation window on iOS. A decoded buffer avoids media startup.
      source.start(0);
      if (context.state !== "running") {
        Promise.resolve(context.resume()).catch(() => {
          this.#fallbackIfPending(source);
        });
        this.resumeTimer = this.setTimer?.(() => {
          if (context.state !== "running") this.#fallbackIfPending(source);
        }, RESUME_TIMEOUT_MS);
      }
      return "web-audio";
    } catch {
      this.#playElement();
      return "element";
    }
  }

  resetAfterBackground() {
    const oldContext = this.context;
    this.generation += 1;
    this.#clearResumeTimer();
    this.#stopSource(this.activeSource);
    this.activeSource = null;
    this.context = null;
    this.buffer = null;
    this.primePromise = null;
    oldContext?.close?.().catch?.(() => {});
    void this.prime();
  }

  async #loadAndDecode(generation) {
    const context = this.#ensureContext();
    if (!context) return false;

    if (!this.encodedAudio) {
      const response = await this.fetchFn(this.element.currentSrc || this.element.src, {
        cache: "force-cache",
      });
      if (!response.ok) throw new Error("Completion sound could not be loaded");
      this.encodedAudio = await response.arrayBuffer();
    }

    const buffer = await context.decodeAudioData(this.encodedAudio.slice(0));
    if (generation !== this.generation || context !== this.context) return false;
    this.buffer = buffer;
    return true;
  }

  #ensureContext() {
    if (!this.AudioContextClass) return null;
    if (this.context && this.context.state !== "closed") return this.context;

    try {
      this.context = new this.AudioContextClass({ latencyHint: "interactive" });
      return this.context;
    } catch {
      return null;
    }
  }

  #fallbackIfPending(source) {
    if (this.activeSource !== source) return;
    this.#stopSource(source);
    this.activeSource = null;
    this.#playElement();
  }

  #playElement() {
    try {
      this.element.pause();
      this.element.currentTime = 0;
      this.element.play().catch(() => {});
    } catch {
      // Logging a habit must still work when audio output is unavailable.
    }
  }

  #stopSource(source) {
    if (!source) return;
    try {
      source.stop();
    } catch {
      // A source that already ended does not need stopping.
    }
    source.disconnect?.();
  }

  #clearResumeTimer() {
    if (this.resumeTimer !== null) this.clearTimer?.(this.resumeTimer);
    this.resumeTimer = null;
  }
}

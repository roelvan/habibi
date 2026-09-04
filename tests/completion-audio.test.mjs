import test from "node:test";
import assert from "node:assert/strict";

import { CompletionAudio } from "../completion-audio.mjs";

function makeHarness({ state = "suspended", withContext = true } = {}) {
  const contexts = [];
  const sources = [];
  const timers = [];
  const element = {
    src: "/completion.mp3",
    currentSrc: "",
    currentTime: 4,
    pauseCalls: 0,
    playCalls: 0,
    pause() {
      this.pauseCalls += 1;
    },
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
  };

  class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.state = state;
      this.destination = {};
      this.resumeCalls = 0;
      contexts.push(this);
    }

    decodeAudioData() {
      return Promise.resolve({ decoded: true });
    }

    createBufferSource() {
      const listeners = {};
      const source = {
        startCalls: 0,
        stopCalls: 0,
        connect() {},
        disconnect() {},
        start() {
          this.startCalls += 1;
        },
        stop() {
          this.stopCalls += 1;
        },
        addEventListener(name, listener) {
          listeners[name] = listener;
        },
      };
      sources.push(source);
      return source;
    }

    resume() {
      this.resumeCalls += 1;
      this.state = "running";
      return Promise.resolve();
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }

  const sound = new CompletionAudio(element, {
    AudioContextClass: withContext ? FakeAudioContext : null,
    fetchFn: async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }),
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => {},
  });

  return { contexts, element, sound, sources, timers };
}

test("predecodes the sound and starts its buffer inside the completion tap", async () => {
  const { contexts, element, sound, sources } = makeHarness();
  assert.equal(await sound.prime(), true);

  assert.equal(sound.play(), "web-audio");
  assert.equal(contexts[0].options.latencyHint, "interactive");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].startCalls, 1);
  assert.equal(element.playCalls, 0);
});

test("falls back to the media element when Web Audio is unavailable", () => {
  const { element, sound } = makeHarness({ withContext: false });

  assert.equal(sound.play(), "element");
  assert.equal(element.pauseCalls, 1);
  assert.equal(element.currentTime, 0);
  assert.equal(element.playCalls, 1);
});

test("stops the queued source and falls back if iOS cannot resume audio", async () => {
  const { element, sound, sources, timers } = makeHarness();
  assert.equal(await sound.prime(), true);
  sound.context.resume = () => new Promise(() => {});

  sound.play();
  assert.equal(timers.length, 1);
  timers[0]();

  assert.equal(sources[0].stopCalls, 1);
  assert.equal(element.playCalls, 1);
});

test("recreates and decodes the context after returning from the background", async () => {
  const { contexts, sound } = makeHarness({ state: "running" });
  assert.equal(await sound.prime(), true);

  sound.resetAfterBackground();
  assert.equal(await sound.prime(), true);

  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].state, "closed");
  assert.ok(sound.buffer);
});

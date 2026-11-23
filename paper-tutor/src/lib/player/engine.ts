import { estimateSeconds, splitSentences, stepDuration, type DrawStep, type Scene, type SceneList } from "@/lib/scenes/types";

// The whiteboard player's clock. It runs scene by scene and sentence by sentence: a sentence starts when the one
// before it has finished (its audio, or its estimated length when muted), and drawing steps start with the
// sentence they belong to. If a sentence's audio isn't ready yet, the clock waits (buffering), so a scene list
// that is still being streamed in plays the same way as a finished one.

export type Clip = { url: string | null; seconds: number; error?: string };
export type VoiceLoader = (sentence: string) => Promise<Clip>;

export type StepTiming = { start: number; dur: number; items?: number[] };

const GAP = 0.28; // breath between sentences
const WIPE = 0.5; // board wipe before a fresh scene
const HOLD = 0.9; // pause after a scene before the next one

export class PlayerEngine {
  list: SceneList;
  sceneIndex = 0;
  time = 0; // seconds into the current scene
  playing = false;
  buffering = false;
  ended = false;
  sentences: string[] = [];
  sentStart: number[] = [];
  sentDur: number[] = [];
  current = -1; // sentence being spoken
  voiceError: string | null = null;
  speed = 1; // playback speed (voice and drawing pace)
  private audioFor = -1; // which sentence of this scene the audio element holds
  private cur: Scene = { say: "", draw: [] };

  private voiceOn: boolean;
  private loader: VoiceLoader;
  private clips = new Map<string, Promise<Clip>>();
  private ready = new Map<string, Clip>();
  private audio: HTMLAudioElement | null = null;
  private raf = 0;
  private last = 0;
  private doneAt = -1;
  private listeners = new Set<() => void>();
  private timingCache: { key: string; value: StepTiming[] } | null = null;

  constructor(list: SceneList, loader: VoiceLoader, voiceOn: boolean) {
    this.list = list;
    this.loader = loader;
    this.voiceOn = voiceOn;
    if (typeof Audio !== "undefined") this.audio = new Audio();
    this.enter(0);
  }

  get scene(): Scene {
    return this.cur;
  }
  // Waiting for a scene that is still being written.
  get waiting(): boolean {
    return Boolean(this.cur.pending);
  }
  get lead(): number {
    return this.sceneIndex > 0 && !this.scene.keep ? WIPE : 0.15;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  // ---- voice ----
  private key(sentence: string) {
    return `${this.voiceOn ? "v" : "m"}|${sentence}`;
  }
  private loadClip(sentence: string) {
    const k = this.key(sentence);
    if (this.clips.has(k)) return;
    const p = this.voiceOn
      ? this.loader(sentence).catch((e: Error) => ({ url: null, seconds: estimateSeconds(sentence), error: e.message }))
      : Promise.resolve<Clip>({ url: null, seconds: estimateSeconds(sentence) });
    this.clips.set(k, p);
    void p.then((clip) => {
      if (clip.error && !this.voiceError) this.voiceError = clip.error;
      this.ready.set(k, clip);
      this.emit();
    });
  }
  private preload(index: number) {
    const scene = this.list.scenes[index];
    if (scene) for (const s of splitSentences(scene.say)) this.loadClip(s);
  }

  setVoice(on: boolean) {
    if (on === this.voiceOn) return;
    this.voiceOn = on;
    this.voiceError = null;
    // Muting keeps the sentence's audio running, silently, so unmuting picks it up at the same moment.
    if (this.audio) this.audio.muted = !on;
    if (on) this.joinCurrentSentence();
    this.preload(this.sceneIndex);
    this.preload(this.sceneIndex + 1);
    this.emit();
  }

  // Voice turned on in the middle of a sentence that started silent: fetch its voice and join at the matching
  // point; the sentence then ends when the voice does.
  private joinCurrentSentence() {
    const k = this.current;
    if (k < 0 || !this.speaking() || this.audioFor === k) return;
    const sentence = this.sentences[k];
    const scene = this.cur;
    this.loadClip(sentence);
    void this.clips.get(this.key(sentence))?.then((clip) => {
      if (!clip.url || !this.audio || this.cur !== scene || this.current !== k || !this.voiceOn || !this.speaking()) return;
      const elapsed = this.time - this.sentStart[k];
      const pos = elapsed * this.speed;
      if (pos >= clip.seconds - 0.3) return; // nearly over: the next sentence will have its voice
      this.audio.src = clip.url;
      this.audio.currentTime = pos;
      this.audio.playbackRate = this.speed;
      this.audio.muted = false;
      this.audioFor = k;
      this.sentDur[k] = elapsed + (clip.seconds - pos) / this.speed;
      this.timingCache = null;
      if (this.playing) void this.audio.play().catch(() => {});
      this.emit();
    });
  }

  // What the audio element is doing (for tests and the debug overlay).
  audioState() {
    const a = this.audio;
    return a
      ? { hasSource: Boolean(a.src) && !a.src.startsWith("data:"), muted: a.muted, paused: a.paused, currentTime: a.currentTime, playbackRate: a.playbackRate, sentence: this.current, voicedSentence: this.audioFor }
      : null;
  }
  get voice() {
    return this.voiceOn;
  }

  setSpeed(v: number) {
    const next = Math.min(2, Math.max(0.5, v));
    const k = this.current;
    // The sentence being spoken keeps its place: only what is left of it is re-timed.
    if (k >= 0 && this.speaking()) {
      const left = this.sentStart[k] + this.sentDur[k] - this.time;
      this.sentDur[k] = this.time - this.sentStart[k] + (left * this.speed) / next;
      this.timingCache = null;
    }
    this.speed = next;
    if (this.audio) this.audio.playbackRate = next;
    this.emit();
  }

  // ---- scenes ----
  private enter(index: number) {
    this.sceneIndex = Math.max(0, Math.min(this.list.scenes.length - 1, index));
    this.cur = this.list.scenes[this.sceneIndex] ?? { say: "", draw: [], pending: true };
    this.time = 0;
    this.sentences = splitSentences(this.scene.say);
    this.sentStart = this.sentences.map(() => NaN);
    this.sentDur = this.sentences.map(() => NaN);
    this.current = -1;
    this.doneAt = -1;
    this.buffering = false;
    this.ended = false;
    this.timingCache = null;
    this.audio?.pause();
    this.audioFor = -1;
    this.preload(this.sceneIndex);
    this.preload(this.sceneIndex + 1);
  }

  goto(index: number) {
    // A backdrop (the board an answer starts from) is never played: go to the scene after it.
    if (this.list.scenes[index]?.backdrop && index + 1 < this.list.scenes.length) index++;
    this.enter(index);
    this.emit();
  }
  next() {
    if (this.sceneIndex < this.list.scenes.length - 1) this.goto(this.sceneIndex + 1);
  }
  prev() {
    // Like a music player: back to the start of this scene first, then the scene before.
    this.goto(this.time > 2 || this.sceneIndex === 0 ? this.sceneIndex : this.sceneIndex - 1);
  }

  // Play a different scene list (another track: the overview, a deep dive...). Starts paused at scene 1.
  load(list: SceneList) {
    this.pause();
    this.list = list;
    this.enter(0);
    this.emit();
  }

  // ---- lists that change while they play ----
  // Scenes being streamed in sit behind a placeholder (pending) scene; the clock waits on it like on audio.

  insertScenes(at: number, scenes: Scene[]) {
    this.list.scenes.splice(Math.max(0, Math.min(this.list.scenes.length, at)), 0, ...scenes);
    this.reconcile();
  }

  // A block of scenes that will arrive over time, starting at index `at`.
  // The block belongs to its list: if the player switches to another track meanwhile, the scenes still land in
  // the list they were written for.
  openBlock(at: number, list: SceneList = this.list) {
    const placeholder: Scene = { say: "", draw: [], pending: true, keep: true };
    list.scenes.splice(Math.max(0, Math.min(list.scenes.length, at)), 0, placeholder);
    if (list === this.list) this.reconcile();
    let open = true;
    return {
      push: (scene: Scene) => {
        if (!open) return;
        const i = list.scenes.indexOf(placeholder);
        if (i < 0) return;
        list.scenes.splice(i, 0, scene);
        if (list === this.list) this.reconcile();
      },
      close: () => {
        if (!open) return;
        open = false;
        const i = list.scenes.indexOf(placeholder);
        if (i >= 0) list.scenes.splice(i, 1);
        if (list === this.list) this.reconcile();
      },
    };
  }

  private reconcile() {
    const scenes = this.list.scenes;
    const idx = scenes.indexOf(this.cur);
    this.timingCache = null;
    if (this.cur.pending && idx !== this.sceneIndex) {
      // A real scene arrived where we were waiting (or the wait was cancelled): start it.
      if (this.sceneIndex < scenes.length) this.enter(this.sceneIndex);
      else {
        this.sceneIndex = Math.max(0, scenes.length - 1);
        this.cur = scenes[this.sceneIndex] ?? this.cur;
        this.ended = true;
        this.pause();
      }
    } else if (idx >= 0) {
      this.sceneIndex = idx;
    } else if (scenes.length) {
      this.enter(Math.min(this.sceneIndex, scenes.length - 1));
    }
    this.preload(this.sceneIndex + 1);
    this.emit();
  }

  play() {
    if (this.ended) this.goto(0);
    this.playing = true;
    this.unlockAudio();
    if (this.audio && this.current >= 0 && this.audio.src && this.speaking()) void this.audio.play().catch(() => {});
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
    this.emit();
  }
  pause() {
    this.playing = false;
    this.audio?.pause();
    cancelAnimationFrame(this.raf);
    this.emit();
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    for (const p of this.clips.values()) void p.then((c) => c.url && URL.revokeObjectURL(c.url));
    this.listeners.clear();
  }

  private unlocked = false;
  // Mobile browsers only let audio start from a tap: play a silent sound inside the tap that pressed Play.
  private unlockAudio() {
    if (this.unlocked || !this.audio) return;
    this.unlocked = true;
    const a = this.audio;
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    void a.play().catch(() => {});
  }

  private speaking() {
    const k = this.current;
    return k >= 0 && this.time < this.sentStart[k] + this.sentDur[k];
  }

  private startSentence(k: number): boolean {
    const clip = this.ready.get(this.key(this.sentences[k]));
    if (!clip) {
      this.loadClip(this.sentences[k]);
      return false;
    }
    this.current = k;
    if (k === 0 && !Number.isNaN(this.sentStart[0])) {
      // The drawing already started while the voice loaded: the sentence runs from then until the voice ends.
      this.sentDur[0] = this.time - this.sentStart[0] + clip.seconds / this.speed;
    } else {
      this.sentStart[k] = this.time;
      this.sentDur[k] = clip.seconds / this.speed;
    }
    this.timingCache = null;
    if (this.audio) {
      if (clip.url) {
        this.audio.src = clip.url;
        this.audio.currentTime = 0;
        this.audio.playbackRate = this.speed;
        this.audio.muted = !this.voiceOn;
        this.audioFor = k;
        if (this.playing) void this.audio.play().catch(() => {});
      } else {
        this.audio.pause();
        this.audioFor = -1;
      }
    }
    return true;
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt);
    this.emit();
    if (this.playing) this.raf = requestAnimationFrame(this.frame);
  };

  private tick(dt: number) {
    if (!this.playing) return;
    if (this.cur.pending) {
      this.buffering = true;
      return;
    }
    const n = this.sentences.length;
    if (n === 0) {
      this.time += dt;
      if (this.time > this.lead + HOLD) this.advance();
      return;
    }
    // Is the next sentence due?
    const due =
      this.current === -1
        ? this.time >= this.lead
        : this.current < n - 1 && this.time >= this.sentStart[this.current] + this.sentDur[this.current] + GAP;
    if (due) {
      const ok = this.startSentence(this.current + 1);
      this.buffering = !ok;
      if (!ok) {
        // A scene's first picture doesn't wait for its voice: start drawing (for up to 2.5 s) while the audio
        // loads, then the voice joins in. Later sentences wait, so words and drawing stay in step.
        if (this.current === -1 && this.time < this.lead + 2.5) {
          if (Number.isNaN(this.sentStart[0])) {
            this.sentStart[0] = this.lead;
            this.sentDur[0] = estimateSeconds(this.sentences[0]) / this.speed;
            this.timingCache = null;
          }
          this.time += dt;
        }
        return;
      }
    }
    this.buffering = false;
    this.time += dt;

    const narrationDone = this.current === n - 1 && this.time >= this.sentStart[n - 1] + this.sentDur[n - 1];
    if (narrationDone && this.time >= this.drawingEnd()) {
      if (this.doneAt < 0) this.doneAt = this.time;
      if (this.time - this.doneAt >= HOLD) this.advance();
    }
  }

  private advance() {
    if (this.sceneIndex < this.list.scenes.length - 1) {
      this.enter(this.sceneIndex + 1);
    } else {
      this.ended = true;
      this.pause();
    }
  }

  // ---- step timing ----
  // Which sentence each step belongs to: its own `s`, or spread evenly over the sentences.
  private sentenceOf(steps: DrawStep[]): number[] {
    const n = Math.max(1, this.sentences.length);
    return steps.map((st, i) => Math.max(0, Math.min(n - 1, st.s ?? Math.floor((i * n) / steps.length))));
  }

  timings(): StepTiming[] {
    const key = `${this.sceneIndex}|${this.sentStart.join(",")}|${this.sentDur.join(",")}`;
    if (this.timingCache?.key === key) return this.timingCache.value;
    const steps = this.scene.draw;
    const sent = this.sentenceOf(steps);
    const counts = new Map<number, number>();
    const value = steps.map((st, i) => {
      const k = sent[i];
      const j = counts.get(k) ?? 0;
      counts.set(k, j + 1);
      const inSentence = sent.filter((x) => x === k).length;
      const base = this.sentStart[k];
      const dur = stepDuration(st);
      if (Number.isNaN(base)) return { start: Infinity, dur, items: st.t === "steps" ? st.items.map(() => Infinity) : undefined };
      const spacing = Math.min(0.9, Math.max(0.22, (this.sentDur[k] * 0.75) / inSentence));
      const start = base + j * spacing;
      if (st.t === "steps") {
        const per = dur / st.items.length;
        const items = st.items.map((_, m) => {
          if (st.pace !== "sentence") return start + m * per;
          const sk = k + m;
          if (sk < this.sentences.length) return this.sentStart[sk];
          return (this.sentStart[this.sentences.length - 1] ?? start) + (sk - this.sentences.length + 1) * 0.8;
        });
        return { start, dur: per, items };
      }
      return { start, dur };
    });
    this.timingCache = { key, value };
    return value;
  }

  private drawingEnd(): number {
    let end = 0;
    for (const t of this.timings()) {
      const last = t.items ? Math.max(...t.items) : t.start;
      end = Math.max(end, last + t.dur);
    }
    return end;
  }

  // The sentence to show as a caption.
  get caption(): string {
    if (this.current < 0) return "";
    return this.sentences[this.current] ?? "";
  }

  // Progress through the current scene, 0..1 (for the scene bar).
  get progress(): number {
    const n = this.sentences.length;
    if (this.current < 0) return 0;
    const spoken = this.current + Math.min(1, (this.time - this.sentStart[this.current]) / (this.sentDur[this.current] || 1));
    return Math.max(0, Math.min(1, spoken / n));
  }
}

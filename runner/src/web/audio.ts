// Soft sound effects, made with Web Audio, plus an optional music loop from public/audio/music.mp3
// (plays only if that file exists, under the effects). It watches the game state change,
// like the visual effects. Browsers only allow sound after a tap or key press, so it starts muted
// until then; the mute choice is remembered.
import type { Game } from "../core/game";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  musicOn = true;
  private musicGain: GainNode | null = null;
  private musicStarted = false;
  private last = { coins: 0, slow: 0, shield: 0, grounded: true, rolling: false, dead: false, powers: 0, tick: 0 };
  private nextBeat = 0;
  /** how many times each sound played (for tests: a headless browser can't listen) */
  readonly played: Record<string, number> = {};

  /** Call from a user gesture (tap, key) so the browser allows sound. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    // music has its own path to the speakers: the Sound switch (effects) never mutes it
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? MUSIC_LEVEL : 0;
    this.musicGain.connect(this.ctx.destination);
    void this.startMusic();
  }

  /** Loop public/audio/music.mp3 if it exists (a missing file is fine: no music). */
  private async startMusic(): Promise<void> {
    if (this.musicStarted || !this.ctx) return;
    this.musicStarted = true;
    try {
      const r = await fetch("/audio/music.mp3");
      // a missing file comes back as the dev server's HTML page: skip it (any other type is decoded)
      if (!r.ok || (r.headers.get("content-type") ?? "").includes("text/html")) return;
      const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // loop only the sound, not the silence at the ends (it would leave a gap at every loop)
      const [from, to] = trimSilence(buf);
      src.loopStart = from;
      src.loopEnd = to;
      src.connect(this.musicGain!);
      src.start(0, from);
    } catch (e) {
      console.warn("music not loaded", e);
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, this.ctx.currentTime, 0.05);
  }

  /** Effects on/off (music is separate: setMusic). */
  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  /** Reset the change tracking for a new run. */
  reset(g: Game): void {
    this.last = { coins: g.coins, slow: g.slowTicks, shield: g.shieldTicks, grounded: g.grounded, rolling: g.rolling, dead: g.dead, powers: powers(g), tick: g.tick };
  }

  update(g: Game): void {
    const l = this.last;
    if (!this.ctx || g.tick === l.tick && g.dead === l.dead) return;
    if (g.coins > l.coins) this.coin(g.doubleTicks > 0);
    if (powers(g) > l.powers) this.chime();
    if (l.grounded && !g.grounded && g.vy > 0) this.whoosh(g.springTicks > 0);
    if (!l.rolling && g.rolling) this.swish();
    if (g.slowTicks > l.slow) this.thud();
    if (l.shield > 0 && g.shieldTicks === 0 && g.graceTicks > 0) this.pop();
    if (!l.dead && g.dead) g.deathCause === "caught" ? this.caught() : this.crash();
    // the ghost's heartbeat while it is close: faster the closer it gets
    if (!g.dead && g.chaserTicks > 0 && this.ctx.currentTime >= this.nextBeat) {
      this.heartbeat();
      this.nextBeat = this.ctx.currentTime + (g.stumbleCount >= g.options.stumblesToCatch - 1 ? 0.5 : 0.75);
    }
    this.reset(g);
  }

  // ---- the sounds: short, soft envelopes

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo = freq, delay = 0): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), gn = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, from: number, to: number, vol: number, q = 1): void {
    const c = this.ctx!, t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), gn = c.createGain();
    src.buffer = buf;
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(gn).connect(this.master!);
    src.start(t);
  }

  private count(name: string): void {
    this.played[name] = (this.played[name] ?? 0) + 1;
  }

  private streak = 0;
  private lastCoin = -1;

  /** A short bell "ding": a bright fundamental plus a metallic overtone (2.76x, like a real bell),
   *  rising a semitone per coin in a quick streak (up to 7). */
  private coin(double: boolean): void {
    this.count("coin");
    const now = this.ctx!.currentTime;
    this.streak = now - this.lastCoin < 0.6 ? Math.min(this.streak + 1, 7) : 0;
    this.lastCoin = now;
    const f = 1568 * Math.pow(2, this.streak / 12); // G6, then up the scale
    this.tone(f, 0.16, "sine", 0.13);
    this.tone(f * 2.76, 0.07, "sine", 0.045);
    this.tone(f * 2, 0.05, "triangle", 0.03);
    if (double) this.tone(f * 1.5, 0.12, "sine", 0.07, f * 1.5, 0.05);
  }

  private chime(): void {
    this.count("powerup");
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.1, f, i * 0.07));
  }
  private whoosh(spring: boolean): void {
    this.count("jump");
    this.noise(spring ? 0.35 : 0.22, 500, spring ? 3000 : 2000, 0.12, 0.8);
  }
  private swish(): void {
    this.count("roll");
    this.noise(0.2, 1800, 400, 0.08, 0.7);
  }
  private thud(): void {
    this.count("stumble");
    this.tone(140, 0.22, "sine", 0.3, 60);
    this.noise(0.12, 600, 200, 0.12);
  }
  private pop(): void {
    this.count("shield");
    this.tone(900, 0.12, "sine", 0.15, 300);
    this.noise(0.08, 3000, 1500, 0.08, 2);
  }
  private heartbeat(): void {
    this.count("heartbeat");
    this.tone(70, 0.12, "sine", 0.28, 50);
    this.tone(64, 0.12, "sine", 0.2, 46, 0.16);
  }
  private crash(): void {
    this.count("crash");
    this.tone(220, 0.35, "sawtooth", 0.08, 70);
    this.noise(0.3, 900, 150, 0.15);
  }
  private caught(): void {
    this.count("caught");
    // a soft "wah-wah" down: playful, not harsh
    [523, 466, 415, 349].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.11, f * 0.97, i * 0.2));
  }
}

/** Music sits under the effects (effects reach ~0.05-0.15 after their 0.5 gain). */
const MUSIC_LEVEL = 0.09;

/** Power-ups taken among the pickups still in the world (a rise = a new pickup). */
const powers = (g: Game) => g.pickups.reduce((n, p) => n + (p.taken && p.kind !== "coin" ? 1 : 0), 0);

/** Seconds where the sound starts and ends (ignoring near-silence at both ends). */
function trimSilence(buf: AudioBuffer, threshold = 0.003): [number, number] {
  const d = buf.getChannelData(0);
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < threshold) a++;
  while (b > a && Math.abs(d[b]) < threshold) b--;
  return [a / buf.sampleRate, (b + 1) / buf.sampleRate];
}

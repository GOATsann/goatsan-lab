// Sound effects synthesized with WebAudio (no files): laser zaps, hits, the headshot ding, eliminations,
// reload clicks, jumps. Volume falls off with distance from the listener.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Call from a user gesture (browsers only allow audio after one). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.4;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private ok(): AudioContext | null { return this.ctx && !this.muted ? this.ctx : null; }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, filter = 0): void {
    const c = this.ok(); if (!c || vol < 0.01) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (filter > 0) { const bq = c.createBiquadFilter(); bq.type = "lowpass"; bq.frequency.value = filter; o.connect(bq); node = bq; }
    node.connect(g); g.connect(this.master!);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, freq: number, delay = 0): void {
    const c = this.ok(); if (!c || !this.noise || vol < 0.01) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const bq = c.createBiquadFilter(); bq.type = "bandpass"; bq.frequency.value = freq; bq.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bq); bq.connect(g); g.connect(this.master!);
    s.start(t); s.stop(t + dur + 0.02);
  }

  /** dist = metres from the listener (0 = you). */
  laser(dist: number, mine: boolean): void {
    const v = mine ? 0.22 : 0.2 / (1 + dist * 0.12);
    this.tone("sawtooth", mine ? 1500 : 1250, 180, 0.13, v, 0, 3200);
    this.tone("square", mine ? 2600 : 2100, 900, 0.05, v * 0.4);
  }
  hit(head: boolean): void {
    if (head) { this.tone("sine", 1760, 1700, 0.18, 0.28); this.tone("sine", 2640, 2600, 0.14, 0.14, 0.02); }
    else this.tone("triangle", 520, 300, 0.08, 0.25);
  }
  hurt(): void { this.burst(0.12, 0.35, 700); this.tone("square", 140, 70, 0.12, 0.18, 0, 900); }
  kill(): void { this.tone("triangle", 660, 660, 0.09, 0.25); this.tone("triangle", 990, 990, 0.16, 0.25, 0.08); }
  eliminated(dist: number): void { const v = 0.35 / (1 + dist * 0.08); this.burst(0.35, v, 400); this.tone("sawtooth", 400, 50, 0.4, v * 0.6, 0, 1200); }
  reload(): void { this.burst(0.04, 0.25, 2500); this.burst(0.05, 0.25, 1800, 0.55); this.tone("square", 900, 1200, 0.06, 0.08, 1.3); }
  jump(): void { this.tone("sine", 220, 380, 0.12, 0.08); }
  spawn(): void { this.tone("sine", 300, 900, 0.35, 0.12); }
}

// Sound effects: laser zaps, hits, the headshot ding, eliminations, reload clicks and jumps are synthesized
// with WebAudio. The Special Moves (and the "ready" chime) use short sound files from public/sfx/ when they
// are there (see ASSETS.md), else synthesized stand-ins. Other robots' Special Moves are positional (3D).
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private samples = new Map<string, AudioBuffer>();
  private samplesLoading = false;

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
    this.loadSamples();
  }

  /** The Special Move sounds (and the ready chime), if public/sfx/ has them. Small files, loaded once. */
  private loadSamples(): void {
    if (this.samplesLoading || !this.ctx) return;
    this.samplesLoading = true;
    const c = this.ctx;
    for (const name of ["dash", "bulwark", "echo", "wisp", "ready"]) {
      fetch(`sfx/${name}.mp3`)
        .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("audio") ? r.arrayBuffer() : Promise.reject(new Error("missing"))))
        .then((b) => c.decodeAudioData(b))
        .then((buf) => this.samples.set(name, buf))
        .catch(() => { /* not there: the synthesized stand-in plays instead */ });
    }
  }

  /** The listener follows the camera (for positional sounds). */
  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      l.positionX.setValueAtTime(px, t); l.positionY.setValueAtTime(py, t); l.positionZ.setValueAtTime(pz, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(px, py, pz);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Play a loaded sample: straight (yours) or from a point in the world (3D). False if not loaded. */
  private sample(name: string, vol: number, at?: { x: number; y: number; z: number }): boolean {
    const c = this.ok(), buf = this.samples.get(name);
    if (!c || !buf) return false;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g);
    if (at) {
      const pan = c.createPanner();
      pan.panningModel = "HRTF";
      pan.distanceModel = "inverse";
      pan.refDistance = 3;
      pan.rolloffFactor = 1.3;
      pan.maxDistance = 60;
      if (pan.positionX) { pan.positionX.value = at.x; pan.positionY.value = at.y; pan.positionZ.value = at.z; }
      else (pan as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at.x, at.y, at.z);
      g.connect(pan);
      pan.connect(this.master!);
    } else g.connect(this.master!);
    src.start();
    return true;
  }

  /** A Special Move: yours plays straight, another robot's from where it is. */
  special(kind: "dash" | "shield" | "scan" | "cloak", mine: boolean, at?: { x: number; y: number; z: number }): void {
    const file = { dash: "dash", shield: "bulwark", scan: "echo", cloak: "wisp" }[kind];
    const vol = { dash: 0.8, shield: 0.9, scan: 0.85, cloak: 0.7 }[kind];
    if (this.sample(file, mine ? vol : vol * 0.9, mine ? undefined : at)) return;
    // stand-ins when the files aren't there
    if (kind === "scan") this.scan(mine);
    else if (kind === "dash") this.burst(0.25, mine ? 0.3 : 0.15, 1400);
    else if (kind === "shield") { this.tone("sine", 90, 140, 0.4, mine ? 0.25 : 0.12); this.tone("square", 600, 300, 0.08, 0.1, 0.3); }
    else this.burst(0.6, mine ? 0.12 : 0.06, 5000);
  }

  /** Your Special Move is ready again: a quiet chime. */
  ready(): void {
    if (!this.sample("ready", 0.32)) this.tone("sine", 1320, 1320, 0.12, 0.06);
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
  /** Echo's Scan: a sonar ping with a falling echo */
  scan(mine: boolean): void {
    const v = mine ? 0.22 : 0.08;
    this.tone("sine", 1400, 1300, 0.5, v);
    this.tone("sine", 700, 650, 0.6, v * 0.5, 0.05);
    this.tone("sine", 1400, 1300, 0.35, v * 0.35, 0.32);
  }
}

// A walkability grid over the floor and A* paths on it. Bots use it to move around the map.
// It is map knowledge only (a player knows the map too), never where the other robots are.

import { RADIUS } from "./config";
import type { MapDef } from "./maps";
import type { Rng } from "./rng";

export const NAV_CELL = 0.5;

export class NavGrid {
  readonly nx: number;
  readonly nz: number;
  readonly x0: number;
  readonly z0: number;
  readonly blocked: Uint8Array;
  private g: Float64Array; private f: Float64Array; private from: Int32Array; private seen: Uint32Array; private closed: Uint32Array;
  private visit = 0;
  private heap: Int32Array; private heapN = 0;
  readonly free: number[] = [];

  constructor(map: MapDef) {
    const b = map.bounds;
    this.x0 = b.x0; this.z0 = b.z0;
    this.nx = Math.round((b.x1 - b.x0) / NAV_CELL);
    this.nz = Math.round((b.z1 - b.z0) / NAV_CELL);
    const n = this.nx * this.nz;
    this.blocked = new Uint8Array(n);
    const m = RADIUS + 0.08;
    for (const o of map.boxes) {
      if (o.y0 >= 1.7 || o.y1 <= 0.35) continue; // overhead (deck, ceiling) or a step you can walk onto
      const i0 = Math.max(0, Math.floor((o.x0 - m - this.x0) / NAV_CELL)), i1 = Math.min(this.nx - 1, Math.floor((o.x1 + m - this.x0) / NAV_CELL - 1e-9));
      const k0 = Math.max(0, Math.floor((o.z0 - m - this.z0) / NAV_CELL)), k1 = Math.min(this.nz - 1, Math.floor((o.z1 + m - this.z0) / NAV_CELL - 1e-9));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) this.blocked[k * this.nx + i] = 1;
    }
    // the outer ring is never walkable (walls)
    for (let i = 0; i < this.nx; i++) { this.blocked[i] = 1; this.blocked[(this.nz - 1) * this.nx + i] = 1; }
    for (let k = 0; k < this.nz; k++) { this.blocked[k * this.nx] = 1; this.blocked[k * this.nx + this.nx - 1] = 1; }
    for (let i = 0; i < n; i++) if (!this.blocked[i]) this.free.push(i);
    this.g = new Float64Array(n); this.f = new Float64Array(n); this.from = new Int32Array(n);
    this.seen = new Uint32Array(n); this.closed = new Uint32Array(n); this.heap = new Int32Array(n * 8 + 16);
  }

  cellOf(x: number, z: number): number {
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.x0) / NAV_CELL)));
    const k = Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.z0) / NAV_CELL)));
    return k * this.nx + i;
  }
  cx(c: number): number { return this.x0 + ((c % this.nx) + 0.5) * NAV_CELL; }
  cz(c: number): number { return this.z0 + (Math.floor(c / this.nx) + 0.5) * NAV_CELL; }
  isFree(x: number, z: number): boolean { return !this.blocked[this.cellOf(x, z)]; }

  /** Nearest walkable cell (spiral search). */
  nearestFree(x: number, z: number): number {
    const c = this.cellOf(x, z);
    if (!this.blocked[c]) return c;
    const ci = c % this.nx, ck = Math.floor(c / this.nx);
    for (let r = 1; r < 40; r++) {
      let best = -1, bd = Infinity;
      for (let k = ck - r; k <= ck + r; k++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) !== r) continue;
        const j = k * this.nx + i;
        if (this.blocked[j]) continue;
        const d = (this.cx(j) - x) ** 2 + (this.cz(j) - z) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) return best;
    }
    return c;
  }

  randomFree(rng: Rng): number {
    return this.free[rng.int(this.free.length)];
  }

  /** Can a robot walk straight from a to b? (samples the grid every quarter cell) */
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(len / (NAV_CELL * 0.25));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      if (this.blocked[this.cellOf(ax + dx * t, az + dz * t)]) return false;
    }
    return true;
  }

  /** A* from (sx, sz) to (gx, gz). Returns cell indices from start to goal ([] if unreachable). */
  findPath(sx: number, sz: number, gx: number, gz: number): number[] {
    const s = this.nearestFree(sx, sz), goal = this.nearestFree(gx, gz);
    if (s === goal) return [goal];
    const v = ++this.visit;
    const nx = this.nx;
    const gi = goal % nx, gk = Math.floor(goal / nx);
    const h = (c: number) => {
      const di = Math.abs((c % nx) - gi), dk = Math.abs(Math.floor(c / nx) - gk);
      return (di + dk) + (Math.SQRT2 - 2) * Math.min(di, dk);
    };
    this.heapN = 0;
    this.seen[s] = v; this.g[s] = 0; this.f[s] = h(s); this.from[s] = -1;
    this.push(s);
    let found = false;
    while (this.heapN > 0) {
      const c = this.pop();
      if (this.closed[c] === v) continue;
      this.closed[c] = v;
      if (c === goal) { found = true; break; }
      const ci = c % nx, ck = Math.floor(c / nx);
      for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
        if (di === 0 && dk === 0) continue;
        const i = ci + di, k = ck + dk;
        if (i < 0 || k < 0 || i >= nx || k >= this.nz) continue;
        const n = k * nx + i;
        if (this.blocked[n] || this.closed[n] === v) continue;
        if (di !== 0 && dk !== 0 && (this.blocked[ck * nx + i] || this.blocked[k * nx + ci])) continue; // no corner cutting
        const ng = this.g[c] + (di !== 0 && dk !== 0 ? Math.SQRT2 : 1);
        if (this.seen[n] !== v || ng < this.g[n]) {
          this.seen[n] = v; this.g[n] = ng; this.f[n] = ng + h(n); this.from[n] = c;
          this.push(n);
        }
      }
    }
    if (!found) return [];
    const path: number[] = [];
    for (let c = goal; c !== -1; c = this.from[c]) path.push(c);
    return path.reverse();
  }

  // binary min-heap on f, ties broken by cell index (deterministic)
  private less(a: number, b: number): boolean { return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && a < b); }
  private push(c: number): void {
    if (this.heapN >= this.heap.length) return; // cannot happen with the size above; stay safe
    let i = this.heapN++;
    this.heap[i] = c;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.heap[i], this.heap[p])) break;
      const t = this.heap[i]; this.heap[i] = this.heap[p]; this.heap[p] = t; i = p;
    }
  }
  private pop(): number {
    const top = this.heap[0];
    const last = this.heap[--this.heapN];
    if (this.heapN > 0) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.heapN && this.less(this.heap[l], this.heap[m])) m = l;
        if (r < this.heapN && this.less(this.heap[r], this.heap[m])) m = r;
        if (m === i) break;
        const t = this.heap[i]; this.heap[i] = this.heap[m]; this.heap[m] = t; i = m;
      }
    }
    return top;
  }
}

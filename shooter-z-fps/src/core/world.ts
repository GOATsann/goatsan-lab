// Static world queries: ray casts (line of sight, hitscan, the AI's rays) and box overlap (movement).
// Boxes live in flat typed arrays; a coarse XZ grid limits each query to the boxes it can touch.

import type { MapDef } from "./maps";

/** What a ray hit. 0 = nothing within range. Agent body parts are added by obs.ts / game.ts. */
export const HIT_NONE = 0, HIT_WALL = 1, HIT_COVER = 2, HIT_FLOOR = 3;

const CELL = 4; // metres per broadphase cell
const EPS = 1e-9;

export class World {
  readonly map: MapDef;
  readonly n: number;
  readonly x0: Float64Array; readonly y0: Float64Array; readonly z0: Float64Array;
  readonly x1: Float64Array; readonly y1: Float64Array; readonly z1: Float64Array;
  readonly kind: Uint8Array;
  // broadphase
  private gx0: number; private gz0: number; private gnx: number; private gnz: number;
  private cells: Int32Array[]; // box indices per cell
  private stamp: Uint32Array; private stampId = 1;

  /** Result of the last raycast. */
  hitT = 0;
  hitKind = HIT_NONE;
  hitBox = -1;

  constructor(map: MapDef) {
    this.map = map;
    const b = map.boxes;
    this.n = b.length;
    this.x0 = new Float64Array(b.map((o) => o.x0)); this.y0 = new Float64Array(b.map((o) => o.y0)); this.z0 = new Float64Array(b.map((o) => o.z0));
    this.x1 = new Float64Array(b.map((o) => o.x1)); this.y1 = new Float64Array(b.map((o) => o.y1)); this.z1 = new Float64Array(b.map((o) => o.z1));
    this.kind = new Uint8Array(b.map((o) => o.kind));
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
    for (const o of b) { mnx = Math.min(mnx, o.x0); mnz = Math.min(mnz, o.z0); mxx = Math.max(mxx, o.x1); mxz = Math.max(mxz, o.z1); }
    this.gx0 = Math.floor(mnx) - 1; this.gz0 = Math.floor(mnz) - 1;
    this.gnx = Math.ceil((mxx + 1 - this.gx0) / CELL); this.gnz = Math.ceil((mxz + 1 - this.gz0) / CELL);
    const lists: number[][] = Array.from({ length: this.gnx * this.gnz }, () => []);
    for (let i = 0; i < this.n; i++) {
      const cx0 = this.cx(this.x0[i]), cx1 = this.cx(this.x1[i]), cz0 = this.cz(this.z0[i]), cz1 = this.cz(this.z1[i]);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) lists[cz * this.gnx + cx].push(i);
    }
    this.cells = lists.map((l) => Int32Array.from(l));
    this.stamp = new Uint32Array(this.n);
  }

  private cx(x: number): number { return Math.max(0, Math.min(this.gnx - 1, Math.floor((x - this.gx0) / CELL))); }
  private cz(z: number): number { return Math.max(0, Math.min(this.gnz - 1, Math.floor((z - this.gz0) / CELL))); }

  /** Index of the first box overlapping this AABB, or -1. */
  overlap(ax0: number, ay0: number, az0: number, ax1: number, ay1: number, az1: number, skip = -1): number {
    const cx0 = this.cx(ax0), cx1 = this.cx(ax1), cz0 = this.cz(az0), cz1 = this.cz(az1);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const list = this.cells[cz * this.gnx + cx];
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        if (i === skip) continue;
        if (ax1 > this.x0[i] + EPS && ax0 < this.x1[i] - EPS && ay1 > this.y0[i] + EPS && ay0 < this.y1[i] - EPS && az1 > this.z0[i] + EPS && az0 < this.z1[i] - EPS) return i;
      }
    }
    return -1;
  }

  /**
   * Cast a ray (d need not be normalised; t is in units of |d|). Hits boxes and the floor (y = 0).
   * Sets hitT / hitKind / hitBox and returns hitT (maxT and HIT_NONE when nothing was hit).
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    let best = maxT, kind = HIT_NONE, boxI = -1;
    if (dy < 0) {
      const t = -oy / dy;
      if (t >= 0 && t < best) { best = t; kind = HIT_FLOOR; }
    }
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const id = ++this.stampId;
    if (id === 0xffffffff) { this.stamp.fill(0); this.stampId = 1; }
    // walk the broadphase cells along the ray in XZ (2D DDA)
    let cx = Math.floor((ox - this.gx0) / CELL), cz = Math.floor((oz - this.gz0) / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(CELL * ix), tdz = Math.abs(CELL * iz);
    let tmx = dx === 0 ? Infinity : ((this.gx0 + (cx + (dx > 0 ? 1 : 0)) * CELL) - ox) * ix;
    let tmz = dz === 0 ? Infinity : ((this.gz0 + (cz + (dz > 0 ? 1 : 0)) * CELL) - oz) * iz;
    let tCell = 0;
    for (let guard = 0; guard < 256; guard++) {
      if (cx >= 0 && cz >= 0 && cx < this.gnx && cz < this.gnz) {
        const list = this.cells[cz * this.gnx + cx];
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          const t = slab(ox, oy, oz, ix, iy, iz, this.x0[i], this.y0[i], this.z0[i], this.x1[i], this.y1[i], this.z1[i], best);
          if (t < best) { best = t; boxI = i; kind = this.kind[i]; }
        }
      } else if ((cx < 0 && stepX < 0) || (cz < 0 && stepZ < 0) || (cx >= this.gnx && stepX > 0) || (cz >= this.gnz && stepZ > 0)) {
        break; // left the grid for good
      }
      // next cell
      if (tmx < tmz) { tCell = tmx; tmx += tdx; cx += stepX; } else { tCell = tmz; tmz += tdz; cz += stepZ; }
      if (tCell > best) break; // everything further is behind the hit
    }
    this.hitT = best; this.hitKind = kind; this.hitBox = boxI;
    return best;
  }

  /** Is the segment a -> b free of boxes? (floor ignored) */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    this.raycast(ax, ay, az, dx, dy === 0 ? 1e-12 : dy, dz, 1);
    return this.hitKind === HIT_NONE || this.hitKind === HIT_FLOOR;
  }
}

/** Ray vs AABB (slab test) with precomputed inverse direction. Returns t of entry, or Infinity. */
export function slab(ox: number, oy: number, oz: number, ix: number, iy: number, iz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxT: number): number {
  let t1 = (x0 - ox) * ix, t2 = (x1 - ox) * ix;
  let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1;
  t1 = (y0 - oy) * iy; t2 = (y1 - oy) * iy;
  let lo = t1 < t2 ? t1 : t2, hi = t1 < t2 ? t2 : t1;
  if (lo > tmin) tmin = lo;
  if (hi < tmax) tmax = hi;
  t1 = (z0 - oz) * iz; t2 = (z1 - oz) * iz;
  lo = t1 < t2 ? t1 : t2; hi = t1 < t2 ? t2 : t1;
  if (lo > tmin) tmin = lo;
  if (hi < tmax) tmax = hi;
  if (tmax < 0 || tmin > tmax || tmin > maxT) return Infinity;
  return tmin < 0 ? 0 : tmin;
}

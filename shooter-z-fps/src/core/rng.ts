// xoshiro128** — a small, fast, seeded PRNG on 32-bit integers (same as runner/).
// The core never uses Math.random: the same seed has to give the same match everywhere.

export class Rng {
  s: Uint32Array;

  constructor(seed: number) {
    // splitmix32 spreads one seed over the 4 state words (all-zero state is invalid).
    this.s = new Uint32Array(4);
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }

  /** Next 32-bit unsigned integer. */
  next(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return this.next() % n;
  }

  /** Float in [0, 1) with 32 bits of randomness. */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** Roughly normal, mean 0, sd 1 (sum of 4 uniforms; no transcendental functions, so deterministic). */
  gauss(): number {
    return (this.float() + this.float() + this.float() + this.float() - 2) * 1.7320508075688772;
  }

  getState(): number[] {
    return Array.from(this.s);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

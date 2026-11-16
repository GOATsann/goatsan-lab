// xoshiro128** — a small, fast, seeded PRNG on 32-bit integers.
// The game must never use Math.random: the same seed has to give the same run everywhere
// (Node for training, every browser for play and replays).

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

  /** Pick one item, by integer weights. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.int(total);
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

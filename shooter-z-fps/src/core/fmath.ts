// Deterministic math. Math.sin/cos/atan2/pow/hypot are not guaranteed to give bit-identical results in
// every JS engine, but + - * / and Math.sqrt are (IEEE 754). The core only uses these functions, so a match
// replays exactly in Node and in every browser.

export const PI = 3.141592653589793;
export const TAU = 2 * PI;
export const HALF_PI = PI / 2;

/** Wrap to [-PI, PI). */
export function wrap(a: number): number {
  return a - TAU * Math.floor((a + PI) / TAU);
}

// Taylor coefficients (exact constants, computed once at load in the same way everywhere)
const S3 = -1 / 6, S5 = 1 / 120, S7 = -1 / 5040, S9 = 1 / 362880, S11 = -1 / 39916800, S13 = 1 / 6227020800, S15 = -1 / 1307674368000;

export function sin(x: number): number {
  x = wrap(x);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (S3 + x2 * (S5 + x2 * (S7 + x2 * (S9 + x2 * (S11 + x2 * (S13 + x2 * S15)))))));
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** atan for any x: range-reduce to |x| <= tan(pi/8), then a series. Error < 1e-10. */
export function atan(x: number): number {
  let sign = 1;
  if (x < 0) { x = -x; sign = -1; }
  const inv = x > 1;
  if (inv) x = 1 / x;
  // half-angle: atan(x) = 2 atan(x / (1 + sqrt(1 + x^2)))
  const y = x / (1 + Math.sqrt(1 + x * x));
  const y2 = y * y;
  let term = y, sum = y;
  for (let n = 3; n <= 25; n += 2) {
    term *= -y2;
    sum += term / n;
  }
  let r = 2 * sum;
  if (inv) r = HALF_PI - r;
  return sign * r;
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

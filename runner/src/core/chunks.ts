// Hand-made track pieces. The generator strings them together with the seeded PRNG and shuffles
// their lanes, so every seed is a different run, but each piece is solvable on its own:
// every obstacle row leaves at least one way through, and there is room to change lanes in time.
//
// Lanes here are "slots" a, b, c (0, 1, 2) that get mapped to real lanes by a random permutation.
// z is in mm from the start of the chunk.

export type ItemKind = "low" | "high" | "train" | "movingTrain" | "ramp" | "coin" | "magnet" | "spring" | "double" | "shield";

export interface ChunkItem {
  kind: ItemKind;
  slot: 0 | 1 | 2;
  z: number;
  /** coins: height above the surface they float over ("roof" = on a train roof) */
  onRoof?: boolean;
  /** coins: extra height in mm (an arc over a barrier) */
  lift?: number;
}

export interface Chunk {
  name: string;
  len: number;
  /** from this distance (m) on, the chunk may appear */
  minMeters: number;
  weight: number;
  items: ChunkItem[];
}

const coinLine = (slot: 0 | 1 | 2, z0: number, n: number, gap = 2500, onRoof = false): ChunkItem[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "coin" as const, slot, z: z0 + i * gap, onRoof }));

export const CHUNKS: Chunk[] = [
  {
    name: "barrier row",
    len: 30000,
    minMeters: 0,
    weight: 4,
    items: [
      { kind: "low", slot: 0, z: 15000 },
      { kind: "high", slot: 1, z: 15000 },
      ...coinLine(2, 9000, 5),
    ],
  },
  {
    name: "coin arc",
    len: 30000,
    minMeters: 0,
    weight: 3,
    items: [
      { kind: "low", slot: 1, z: 15000 },
      ...[[11000, 300], [13000, 1100], [15000, 1500], [17000, 1100], [19000, 300]].map(([z, lift]) =>
        ({ kind: "coin" as const, slot: 1 as const, z, lift })),
    ],
  },
  {
    name: "zigzag",
    len: 45000,
    minMeters: 0,
    weight: 3,
    items: [
      { kind: "low", slot: 0, z: 10000 },
      { kind: "high", slot: 1, z: 22000 },
      { kind: "low", slot: 2, z: 34000 },
      ...coinLine(1, 6000, 3),
    ],
  },
  {
    name: "power-up",
    len: 30000,
    minMeters: 100,
    weight: 1,
    items: [
      { kind: "magnet", slot: 1, z: 15000 },
      ...coinLine(0, 10000, 6),
      ...coinLine(2, 10000, 6),
    ],
  },
  {
    name: "spring shoes",
    len: 30000,
    minMeters: 200,
    weight: 1,
    items: [{ kind: "spring", slot: 0, z: 15000 }, ...coinLine(1, 10000, 5)],
  },
  {
    name: "double coins",
    len: 30000,
    minMeters: 200,
    weight: 1,
    items: [{ kind: "double", slot: 2, z: 15000 }, ...coinLine(2, 18000, 4)],
  },
  {
    name: "shield",
    len: 30000,
    minMeters: 500,
    weight: 1,
    items: [{ kind: "shield", slot: 1, z: 15000 }, ...coinLine(0, 12000, 4)],
  },
  {
    name: "two trains",
    len: 40000,
    minMeters: 300,
    weight: 3,
    items: [
      { kind: "train", slot: 0, z: 10000 },
      { kind: "train", slot: 1, z: 12000 },
      ...coinLine(2, 10000, 8),
    ],
  },
  {
    name: "ramp to the roofs",
    len: 50000,
    minMeters: 400,
    weight: 3,
    items: [
      { kind: "ramp", slot: 0, z: 8000 },
      { kind: "train", slot: 0, z: 16000 },
      { kind: "train", slot: 1, z: 16000 },
      { kind: "low", slot: 2, z: 24000 },
      ...coinLine(0, 18000, 7, 2500, true),
    ],
  },
  {
    name: "oncoming train",
    // the train starts moving when the player is 60 m away and can travel up to ~30 m back,
    // so the first 30 m of this chunk stay clear in its lane
    len: 60000,
    minMeters: 700,
    weight: 2,
    items: [
      { kind: "movingTrain", slot: 0, z: 35000 },
      { kind: "train", slot: 1, z: 30000 },
      { kind: "high", slot: 2, z: 40000 },
      ...coinLine(2, 30000, 4),
    ],
  },
  {
    name: "train wall",
    len: 50000,
    minMeters: 1000,
    weight: 2,
    items: [
      { kind: "ramp", slot: 1, z: 6000 },
      { kind: "train", slot: 1, z: 14000 },
      { kind: "train", slot: 0, z: 14000 },
      { kind: "train", slot: 2, z: 16000 },
      ...coinLine(1, 16000, 7, 2500, true),
    ],
  },
];

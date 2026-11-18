// The maps, as solid boxes. The core only needs geometry (collision, line of sight, hitscan) and a
// surface label for the AI's rays (wall or cover). `style` is a hint for the renderer and never changes
// gameplay. Every map is point-symmetric through the origin ((x, z) -> (-x, -z)), so no spawn side is better.
//
// Axes: x east, y up, z south. The floor is the plane y = 0.

export const WALL = 1;
export const COVER = 2;
export type Surface = typeof WALL | typeof COVER;

export interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  kind: Surface;
  style: string;
}

export interface MapDef {
  id: MapId;
  name: string;
  /** Playable area (inside the outer walls). */
  bounds: { x0: number; z0: number; x1: number; z1: number };
  boxes: Box[];
  spawns: { x: number; z: number }[];
  /** Places worth checking: bots patrol between them. */
  pois: { x: number; z: number }[];
  /** Height of the ceiling, if any (renderer + info; the ceiling itself is boxes). */
  ceiling: number;
}

export type MapId = "base" | "ship";
export const MAP_IDS: MapId[] = ["base", "ship"];

// ---- helpers
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: Surface, style: string): Box => ({
  x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), kind, style,
});
/** Box from a centre on the floor and a size. */
const at = (cx: number, cz: number, sx: number, sz: number, h: number, kind: Surface, style: string, y0 = 0): Box =>
  box(cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + h, cz + sz / 2, kind, style);
const mirror = (b: Box): Box => ({ ...b, x0: -b.x1, x1: -b.x0, z0: -b.z1, z1: -b.z0 });
const mirrorPt = (p: { x: number; z: number }) => ({ x: -p.x, z: -p.z });

/** `once` boxes are placed as they are (they must already be symmetric); `half` boxes get a mirrored twin. */
function build(def: Omit<MapDef, "boxes" | "spawns" | "pois"> & { once: Box[]; half: Box[]; spawns: { x: number; z: number }[]; pois: { x: number; z: number }[] }): MapDef {
  return {
    id: def.id, name: def.name, bounds: def.bounds, ceiling: def.ceiling,
    boxes: [...def.once, ...def.half, ...def.half.map(mirror)],
    spawns: [...def.spawns, ...def.spawns.map(mirrorPt)],
    pois: [...def.pois, ...def.pois.map(mirrorPt)],
  };
}

// Shipping container: 2.44 x 2.6 x 6.06 m
const CW = 2.44, CH = 2.6, CL = 6.06;

// ---------------------------------------------------------------------------------------------
// Army training base: a walled yard with shipping containers, sandbag walls and a watchtower in the middle.
function armyBase(): MapDef {
  const S = 24, WH = 3.6, T = 0.5; // half size, wall height, wall thickness
  const once: Box[] = [
    // perimeter wall
    box(-S - T, 0, -S - T, S + T, WH, -S, WALL, "perimeter"),
    box(-S - T, 0, S, S + T, WH, S + T, WALL, "perimeter"),
    box(-S - T, 0, -S, -S, WH, S, WALL, "perimeter"),
    box(S, 0, -S, S + T, WH, S, WALL, "perimeter"),
    // watchtower: 4 legs, a deck at 3.2 m, rails, a roof
    at(-1.75, -1.75, 0.3, 0.3, 3.0, WALL, "tower-leg"),
    at(1.75, -1.75, 0.3, 0.3, 3.0, WALL, "tower-leg"),
    at(-1.75, 1.75, 0.3, 0.3, 3.0, WALL, "tower-leg"),
    at(1.75, 1.75, 0.3, 0.3, 3.0, WALL, "tower-leg"),
    box(-2, 3.0, -2, 2, 3.2, 2, WALL, "tower-deck"),
    box(-2.3, 5.7, -2.3, 2.3, 5.9, 2.3, WALL, "tower-roof"),
    // rails: east and west sides full length
    box(1.9, 3.2, -2, 2, 4.2, 2, COVER, "tower-rail"),
    box(-2, 3.2, -2, -1.9, 4.2, 2, COVER, "tower-rail"),
    // roof posts
    at(-1.95, -1.95, 0.14, 0.14, 2.5, WALL, "tower-post", 3.2),
    at(1.95, -1.95, 0.14, 0.14, 2.5, WALL, "tower-post", 3.2),
    at(-1.95, 1.95, 0.14, 0.14, 2.5, WALL, "tower-post", 3.2),
    at(1.95, 1.95, 0.14, 0.14, 2.5, WALL, "tower-post", 3.2),
  ];
  const half: Box[] = [
    // south rail with a gap where the stairs arrive (x 0.4..1.4)
    box(-1.9, 3.2, 1.9, 0.4, 4.2, 2, COVER, "tower-rail"),
    box(1.4, 3.2, 1.9, 1.9, 4.2, 2, COVER, "tower-rail"),
  ];
  // stairs up to the deck from the south (and, mirrored, from the north): 10 steps of 0.32 m
  for (let k = 1; k <= 10; k++) {
    const z0 = 2 + (10 - k) * 0.4;
    half.push(box(0.4, 0, z0, 1.4, 0.32 * k, z0 + 0.4, WALL, "stair"));
  }
  half.push(
    // containers
    box(-15, 0, 10.8, -15 + CL, CH, 10.8 + CW, WALL, "container:red"),
    box(8.8, 0, 11, 8.8 + CW, CH, 11 + CL, WALL, "container:blue"),
    box(-22.4, 0, 3, -22.4 + CW, CH, 3 + CL, WALL, "container:green"),
    box(-22.4, CH, 3, -22.4 + CW, 2 * CH, 3 + CL, WALL, "container:yellow"),
    box(13, 0, 2.8, 13 + CL, CH, 2.8 + CW, WALL, "container:teal"),
    box(-7, 0, 15.2, -7 + CL, CH, 15.2 + CW, WALL, "container:orange"),
    // sandbag walls (1 m: cover you can shoot over standing, hide behind crouched)
    box(-6, 0, 7, -1.2, 1.0, 7.7, COVER, "sandbag"),
    box(3, 0, 9, 7, 1.0, 9.7, COVER, "sandbag"),
    box(-15, 0, 2, -11, 1.0, 2.7, COVER, "sandbag"),
    box(-15, 0, 2.7, -14.3, 1.0, 5.2, COVER, "sandbag"),
    box(18, 0, 11, 21.5, 1.0, 11.7, COVER, "sandbag"),
    box(-20, 0, 15, -17, 1.0, 15.7, COVER, "sandbag"),
    // crates
    at(4.5, 4.2, 1.2, 1.2, 1.2, COVER, "crate"),
    at(-8.5, 3.0, 1.2, 1.2, 1.2, COVER, "crate"),
    at(-7.3, 3.0, 1.2, 1.2, 1.2, COVER, "crate"),
    at(-7.9, 3.0, 1.2, 1.2, 1.2, COVER, "crate", 1.2),
    at(20.5, 19.5, 1.2, 1.2, 1.2, COVER, "crate"),
    // concrete barriers
    at(13, 8.6, 2.4, 0.6, 0.85, COVER, "barrier"),
    at(-3, 11.8, 0.6, 2.4, 0.85, COVER, "barrier"),
    at(9, 20, 2.4, 0.6, 0.85, COVER, "barrier"),
  );
  return build({
    id: "base", name: "Army training base", ceiling: 0,
    bounds: { x0: -S, z0: -S, x1: S, z1: S },
    once, half,
    spawns: [{ x: -18, z: 20.5 }, { x: 0, z: 21 }, { x: 17.5, z: 21.5 }],
    pois: [{ x: 0, z: 5 }, { x: -11, z: 7.5 }, { x: 11, z: 7 }, { x: -18, z: 12 }, { x: 18, z: 15 }, { x: 4, z: 14 }, { x: 0, z: 0 }],
  });
}

// ---------------------------------------------------------------------------------------------
// Spaceship: spawn rooms at both ends, side corridors with windows onto space, a tall cargo bay in the middle.
function spaceship(): MapDef {
  const X = 15, Z = 24, T = 0.6, H = 4, BAY_H = 7.5;
  const IW = 0.4; // inner wall thickness
  const once: Box[] = [
    // hull: long sides have windows, ends too
    box(-X - T, 0, -Z - T, X + T, H, -Z, WALL, "window-end"),
    box(-X - T, 0, Z, X + T, H, Z + T, WALL, "window-end"),
    box(-X - T, 0, -Z, -X, H, Z, WALL, "window"),
    box(X, 0, -Z, X + T, H, Z, WALL, "window"),
    // ceilings: low over rooms and corridors, high over the cargo bay
    box(-X, H, 8, X, H + 0.4, Z, WALL, "ceiling"),
    box(-X, H, -Z, X, H + 0.4, -8, WALL, "ceiling"),
    box(9.6, H, -8, X, H + 0.4, 8, WALL, "ceiling"),
    box(-X, H, -8, -9.6, H + 0.4, 8, WALL, "ceiling"),
    box(-9.6, BAY_H, -8, 9.6, BAY_H + 0.4, 8, WALL, "ceiling-bay"),
    // upper bay walls (between the low ceiling and the bay ceiling)
    box(9.6, H, -8, 10, BAY_H, 8, WALL, "bay-upper"),
    box(-10, H, -8, -9.6, BAY_H, 8, WALL, "bay-upper"),
    box(-9.6, H, 7.8, 9.6, BAY_H, 8.2, WALL, "bay-upper"),
    box(-9.6, H, -8.2, 9.6, BAY_H, -7.8, WALL, "bay-upper"),
    // inner walls between the middle and the side corridors (x = +-9.8), doors at z = +-12 and 0
    ...[[-17, -13], [-11, -1.5], [1.5, 11], [13, 17]].flatMap(([a, b]) => [
      box(9.6, 0, a, 9.6 + IW, H, b, WALL, "bulkhead"),
      box(-9.6 - IW, 0, a, -9.6, H, b, WALL, "bulkhead"),
    ]),
    // the long cargo pallet in the middle of the bay
    box(-1, 0, -2.5, 1, 1.3, 2.5, COVER, "cargo-long"),
  ];
  const half: Box[] = [
    // bulkhead between spawn room and crew deck (z = 16.8), three doors
    box(-X, 0, 16.6, -12, H, 17, WALL, "bulkhead"),
    box(-10, 0, 16.6, -1.4, H, 17, WALL, "bulkhead"),
    box(1.4, 0, 16.6, 10, H, 17, WALL, "bulkhead"),
    box(12, 0, 16.6, X, H, 17, WALL, "bulkhead"),
    // bay wall toward the crew deck, wide opening in the middle
    box(-9.6, 0, 7.8, -4, H, 8.2, WALL, "bulkhead"),
    box(4, 0, 7.8, 9.6, H, 8.2, WALL, "bulkhead"),
    // cargo in the bay
    at(-4.8, 3.6, 2, 2, 2, WALL, "cargo"),
    at(5.2, 1.2, 1.2, 1.2, 1.2, COVER, "cargo-small"),
    at(6.6, 5.0, 2, 2, 2, WALL, "cargo"),
    at(6.6, 5.0, 2, 2, 2, WALL, "cargo", 2),
    at(-7.4, -1.2, 1.2, 1.2, 1.2, COVER, "cargo-small"),
    // crew deck: consoles (low cover) and pillars
    box(-6.5, 0, 12, -3, 1.1, 12.8, COVER, "console"),
    box(2, 0, 10.4, 5.5, 1.1, 11.2, COVER, "console"),
    at(6.5, 14.2, 0.8, 0.8, H, WALL, "pillar"),
    at(-7.8, 9.6, 0.8, 0.8, H, WALL, "pillar"),
    // side corridors: a crate and a pipe housing to duck behind
    at(12.6, 6.5, 1.2, 1.2, 1.2, COVER, "cargo-small"),
    box(14.2, 0, -6, 15, 1.0, -3, COVER, "pipes"),
    // spawn room cover
    at(-6, 19.6, 1.2, 1.2, 1.2, COVER, "cargo-small"),
    at(6.5, 20.5, 1.2, 1.2, 1.2, COVER, "cargo-small"),
  ];
  return build({
    id: "ship", name: "Spaceship", ceiling: H,
    bounds: { x0: -X, z0: -Z, x1: X, z1: Z },
    once, half,
    spawns: [{ x: -11, z: 21.5 }, { x: 0, z: 22 }, { x: 11, z: 21.5 }],
    pois: [{ x: 0, z: 5 }, { x: -5, z: 0 }, { x: 12.3, z: 0 }, { x: 12.3, z: 12 }, { x: 0, z: 13 }, { x: -6, z: 14.5 }, { x: 4, z: 0 }],
  });
}

const CACHE = new Map<MapId, MapDef>();
export function getMap(id: MapId): MapDef {
  let m = CACHE.get(id);
  if (!m) {
    m = id === "base" ? armyBase() : spaceship();
    CACHE.set(id, m);
  }
  return m;
}

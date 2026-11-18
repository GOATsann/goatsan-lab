// Builds the 3D map from the core's boxes. Gameplay geometry comes only from the core; everything here is
// looks: materials, props dressed onto the same boxes, scenery outside the play area, lights.
// Two looks: the greybox blockout (a build stage) and the finished map.
// Cheap by design: geometry merged per material (few draw calls), instancing for repeated props,
// small canvas textures, one shadow-casting light, fake ambient occlusion in the shader.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Box, MapDef } from "../core/maps";
import { COVER } from "../core/maps";
import type { Graphics, Look } from "./stage";
import * as TX from "./textures";

export interface MapView {
  group: THREE.Group;
  /** called every frame (animated scenery) */
  update(t: number): void;
  /** ceiling meshes (hidden for top-down cutaway shots) */
  ceilings: THREE.Object3D[];
  /** the key light (follows the camera's area for shadows if needed) */
  sun: THREE.DirectionalLight | null;
}

// ------------------------------------------------------------------------------------------ helpers
const boxGeo = (b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }) => {
  const g = new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
  g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  return g;
};

/** Box geometry whose UVs are in world metres / `scale`, so tiled textures keep their size on any box. */
function worldBox(b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, scale: number): THREE.BufferGeometry {
  const sx = b.x1 - b.x0, sy = b.y1 - b.y0, sz = b.z1 - b.z0;
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / scale, (uv.getY(i) * dims[f][1]) / scale);
  }
  g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  return g;
}

function merged(geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true, receive = true): THREE.Mesh | null {
  if (!geos.length) return null;
  const list = geos.map((g) => {
    let x = g.index ? g.toNonIndexed() : g;
    if (!x.attributes.uv) x.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    if (x.attributes.color) { x = x.clone(); x.deleteAttribute("color"); }
    return x;
  });
  const m = new THREE.Mesh(mergeGeometries(list, false)!, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/**
 * Fake ambient occlusion: surfaces darken toward the floor (and under low ceilings), like soft contact
 * shadows, at no cost (a few shader lines).
 */
function withAO<T extends THREE.Material>(mat: T, strength = 0.42, height = 1.3, ceiling = 0): T {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vAoY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvec4 aoP = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\naoP = instanceMatrix * aoP;\n#endif\nvAoY = (modelMatrix * aoP).y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAoY;")
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>
float aoK = mix(${(1 - strength).toFixed(3)}, 1.0, smoothstep(0.0, ${height.toFixed(3)}, vAoY));
${ceiling > 0 ? `aoK *= mix(0.72, 1.0, smoothstep(0.0, 0.9, ${ceiling.toFixed(3)} - vAoY));` : ""}
reflectedLight.indirectDiffuse *= aoK;
reflectedLight.directDiffuse *= mix(1.0, aoK, 0.55);`);
  };
  mat.customProgramCacheKey = () => `ao${strength}_${height}_${ceiling}`;
  return mat;
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
const tiled = (t: THREE.Texture) => { const c = t.clone(); c.needsUpdate = true; return c; };

/** Soft dark blobs on the floor under everything that stands on it (contact shadows that never flicker). */
function contactShadows(boxes: Box[]): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.filter = "blur(14px)";
  g.fillStyle = "rgba(0,0,0,0.85)";
  g.fillRect(30, 30, 68, 68);
  const tex = new THREE.CanvasTexture(c);
  const geos: THREE.BufferGeometry[] = [];
  for (const b of boxes) {
    if (b.y0 > 0.01 || b.style.startsWith("ceiling")) continue;
    const pad = 0.55;
    const w = b.x1 - b.x0 + pad * 2.2, d = b.z1 - b.z0 + pad * 2.2;
    const p = new THREE.PlaneGeometry(w, d);
    p.rotateX(-Math.PI / 2);
    p.translate((b.x0 + b.x1) / 2, 0.012, (b.z0 + b.z1) / 2);
    geos.push(p);
  }
  const m = new THREE.Mesh(mergeGeometries(geos, false)!, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.renderOrder = 1;
  return m;
}

function sunLight(color: string, intensity: number, dir: THREE.Vector3, span: number, graphics: Graphics): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.position.copy(dir).multiplyScalar(60);
  sun.target.position.set(0, 0, 0);
  if (graphics === "normal") {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -span; c.right = span; c.top = span; c.bottom = -span; c.near = 1; c.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  return sun;
}

// ------------------------------------------------------------------------------------------ greybox
export function buildGreybox(map: MapDef, scene: THREE.Scene): MapView {
  const group = new THREE.Group();
  scene.background = new THREE.Color("#c9ced6");
  scene.fog = null;
  const b = map.bounds;
  const size = Math.max(b.x1 - b.x0, b.z1 - b.z0) + 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0 + 4, b.z1 - b.z0 + 4), new THREE.MeshLambertMaterial({ color: "#9aa0a8" }));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  const grid = new THREE.GridHelper(size, size, 0x6b7079, 0x868b93);
  grid.position.y = 0.01;
  group.add(grid);
  const walls: THREE.BufferGeometry[] = [], cover: THREE.BufferGeometry[] = [], edges: THREE.BufferGeometry[] = [], ceil: THREE.BufferGeometry[] = [];
  for (const o of map.boxes) {
    const g = boxGeo(o);
    if (o.style.startsWith("ceiling")) { ceil.push(g); continue; }
    (o.kind === COVER ? cover : walls).push(g);
    edges.push(new THREE.EdgesGeometry(g));
  }
  group.add(merged(walls, new THREE.MeshLambertMaterial({ color: "#d9dce1" }), false, false)!);
  group.add(merged(cover, new THREE.MeshLambertMaterial({ color: "#e8b04a" }), false, false)!);
  const ceilings: THREE.Object3D[] = [];
  const cm = merged(ceil, new THREE.MeshLambertMaterial({ color: "#d9dce1" }), false, false);
  if (cm) { cm.visible = false; group.add(cm); ceilings.push(cm); }
  group.add(new THREE.LineSegments(mergeGeometries(edges, false)!, new THREE.LineBasicMaterial({ color: "#4b5059" })));
  const sun = new THREE.DirectionalLight("#ffffff", 1.4);
  sun.position.set(20, 40, 12);
  group.add(new THREE.HemisphereLight("#ffffff", "#7a808a", 1.6), sun);
  return { group, update() {}, ceilings, sun: null };
}

// ------------------------------------------------------------------------------------- army base
function buildBase(map: MapDef, scene: THREE.Scene, graphics: Graphics): MapView {
  const group = new THREE.Group();
  const low = graphics === "low";
  const horizon = new THREE.Color("#dfe8ee");
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, 80, 380);

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), new THREE.MeshBasicMaterial({ map: TX.skyGradient("#3f86d6", "#a9cdef", "#e4ecf0"), side: THREE.BackSide, fog: false, depthWrite: false }));
  group.add(sky);
  // lights: warm late-morning sun + sky/ground bounce
  const sun = sunLight("#ffe7c4", 3.0, new THREE.Vector3(0.55, 0.85, 0.35).normalize(), 30, graphics);
  group.add(sun, sun.target, new THREE.HemisphereLight("#cfe3ff", "#a48a62", 1.25));
  // ground
  const sand = tiled(TX.sandTex()); sand.repeat.set(75, 75);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), withAO(std({ map: sand, color: "#e8dcc2" }), 0, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  group.add(contactShadows(map.boxes));
  // painted lines on the yard: a lane grid and spawn circles
  const paint = new THREE.MeshBasicMaterial({ color: "#f4f1e6", transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const lines: THREE.BufferGeometry[] = [];
  for (const x of [-12, 12]) { const p = new THREE.PlaneGeometry(0.12, 46); p.rotateX(-Math.PI / 2); p.translate(x, 0.011, 0); lines.push(p); }
  for (const z of [-12, 12]) { const p = new THREE.PlaneGeometry(46, 0.12); p.rotateX(-Math.PI / 2); p.translate(0, 0.011, z); lines.push(p); }
  for (const s of map.spawns) { const r = new THREE.RingGeometry(0.9, 1.05, 32); r.rotateX(-Math.PI / 2); r.translate(s.x, 0.012, s.z); lines.push(r); }
  group.add(new THREE.Mesh(mergeGeometries(lines, false)!, paint));

  // materials
  const concrete = withAO(std({ map: tiled(TX.concreteTex()), color: "#c9c4b8" }));
  const corr = TX.corrugatedTex();
  const containerColors: Record<string, string> = { red: "#b8452f", blue: "#2f6fa8", green: "#4b7d3a", yellow: "#d8a425", teal: "#2c8c87", orange: "#d4702a" };
  const containerMats = new Map<string, THREE.MeshStandardMaterial>();
  const frameMat = withAO(std({ color: "#3a3d42", roughness: 0.6, metalness: 0.3 }));
  const wood = withAO(std({ map: tiled(TX.planksTex()), color: "#a77b4f" }));
  const darkWood = withAO(std({ map: tiled(TX.planksTex()), color: "#7a5636" }));
  const roofMat = std({ map: tiled(corr), color: "#5f7451", roughness: 0.6, metalness: 0.2 });
  const crateMat = withAO(std({ map: TX.woodCrateTex() }));

  const bucket = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const put = (m: THREE.Material, g: THREE.BufferGeometry) => { if (!bucket.has(m)) bucket.set(m, []); bucket.get(m)!.push(g); };
  const bags: { b: Box }[] = [];
  const barriers: Box[] = [];

  for (const o of map.boxes) {
    const st = o.style;
    if (st === "perimeter") {
      put(concrete, worldBox(o, 3));
      // darker cap on top
      put(frameMat, boxGeo({ ...o, y0: o.y1, y1: o.y1 + 0.12, x0: o.x0 - 0.06, x1: o.x1 + 0.06, z0: o.z0 - 0.06, z1: o.z1 + 0.06 }));
    } else if (st.startsWith("container")) {
      const col = st.split(":")[1] ?? "red";
      if (!containerMats.has(col)) containerMats.set(col, withAO(std({ map: tiled(corr), color: containerColors[col] ?? "#888", roughness: 0.55, metalness: 0.25 })));
      // ridges run vertically on the long sides
      put(containerMats.get(col)!, worldBox(o, 2.6));
      // corner posts and top/bottom rails
      const t = 0.09;
      for (const [x, z] of [[o.x0, o.z0], [o.x1, o.z0], [o.x0, o.z1], [o.x1, o.z1]]) put(frameMat, boxGeo({ x0: x - t, x1: x + t, z0: z - t, z1: z + t, y0: o.y0, y1: o.y1 + 0.01 }));
      for (const y of [o.y0, o.y1 - 0.1]) {
        put(frameMat, boxGeo({ x0: o.x0 - 0.02, x1: o.x1 + 0.02, z0: o.z0 - 0.02, z1: o.z0 + 0.06, y0: y, y1: y + 0.12 }));
        put(frameMat, boxGeo({ x0: o.x0 - 0.02, x1: o.x1 + 0.02, z0: o.z1 - 0.06, z1: o.z1 + 0.02, y0: y, y1: y + 0.12 }));
      }
    } else if (st === "sandbag") {
      bags.push({ b: o });
    } else if (st === "crate") {
      put(crateMat, boxGeo(o));
    } else if (st === "barrier") {
      barriers.push(o);
    } else if (st === "tower-leg" || st === "tower-post") {
      put(darkWood, worldBox(o, 1));
    } else if (st === "tower-deck" || st === "tower-rail" || st === "stair") {
      put(wood, worldBox(o, 1.2));
    } else if (st === "tower-roof") {
      put(roofMat, worldBox(o, 2));
      const cone = new THREE.ConeGeometry(3.4, 1.1, 4, 1);
      cone.rotateY(Math.PI / 4);
      cone.translate(0, o.y1 + 0.55, 0);
      put(roofMat, cone);
    } else {
      put(concrete, worldBox(o, 3));
    }
  }
  for (const [m, geos] of bucket) group.add(merged(geos, m)!);

  // sandbags: one instanced mesh for every bag on the map
  const bagGeo = new RoundedBoxGeometry(0.52, 0.25, 0.34, 2, 0.1);
  const bagMat = withAO(std({ color: "#b9a77e", roughness: 1 }), 0.35, 0.9);
  const placements: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  let k = 0;
  const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  for (const { b } of bags) {
    const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
    const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0, depth = alongX ? b.z1 - b.z0 : b.x1 - b.x0;
    const rows = Math.round((b.y1 - b.y0) / 0.25), deep = Math.max(1, Math.round(depth / 0.35));
    for (let r = 0; r < rows; r++) for (let d = 0; d < deep; d++) {
      const off = r % 2 ? 0.25 : 0;
      for (let s = off; s < len - 0.2; s += 0.5) {
        k++;
        const u = s + 0.26, v = (d + 0.5) * (depth / deep);
        const jitter = Math.sin(k * 12.9898) * 0.5;
        pos.set(alongX ? b.x0 + u : b.x0 + v, b.y0 + 0.12 + r * 0.245, alongX ? b.z0 + v : b.z0 + u);
        e.set(0, (alongX ? 0 : Math.PI / 2) + jitter * 0.12, jitter * 0.04);
        q.setFromEuler(e);
        sc.set(1 + jitter * 0.06, 1, 1);
        placements.push(new THREE.Matrix4().compose(pos, q, sc));
        colors.push(new THREE.Color("#c4b28a").multiplyScalar(0.88 + 0.12 * Math.abs(Math.sin(k * 78.233))));
      }
    }
  }
  const bagMesh = new THREE.InstancedMesh(bagGeo, bagMat, placements.length);
  placements.forEach((m, i) => { bagMesh.setMatrixAt(i, m); bagMesh.setColorAt(i, colors[i]); });
  bagMesh.castShadow = bagMesh.receiveShadow = true;
  group.add(bagMesh);

  // concrete jersey barriers: an extruded profile
  const prof = new THREE.Shape();
  prof.moveTo(-0.3, 0); prof.lineTo(0.3, 0); prof.lineTo(0.3, 0.12); prof.lineTo(0.12, 0.3); prof.lineTo(0.09, 0.85); prof.lineTo(-0.09, 0.85); prof.lineTo(-0.12, 0.3); prof.lineTo(-0.3, 0.12); prof.closePath();
  const barGeos: THREE.BufferGeometry[] = [];
  for (const b of barriers) {
    const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
    const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
    const g = new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    g.translate((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    barGeos.push(g);
  }
  if (barGeos.length) group.add(merged(barGeos, withAO(std({ color: "#c8c3b6", map: tiled(TX.concreteTex()) })))!);

  // ---- scenery outside the walls (never inside the play area)
  // hills
  const hillMat = std({ color: "#7f9a62", flatShading: true, roughness: 1 });
  const hillGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.sin(i * 3.1) * 0.2;
    const r = 250 + (i % 3) * 40;
    const h = new THREE.IcosahedronGeometry(40 + (i % 4) * 12, 1);
    h.scale(1.8, 0.32 + (i % 5) * 0.06, 1.2);
    h.translate(Math.cos(a) * r, -4, Math.sin(a) * r);
    hillGeos.push(h);
  }
  group.add(merged(hillGeos, hillMat, false, false)!);
  // trees: instanced pines in clumps around the base
  const treeGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6).translate(0, 0.7, 0),
    new THREE.ConeGeometry(1.7, 3.2, 7).translate(0, 2.8, 0),
    new THREE.ConeGeometry(1.25, 2.6, 7).translate(0, 4.3, 0),
  ].map((g) => g.toNonIndexed()), true)!;
  const treeMats = [std({ color: "#6b4a2e" }), std({ color: "#3f6b3a", flatShading: true }), std({ color: "#4a7a40", flatShading: true })];
  const nTrees = low ? 40 : 110;
  const trees = new THREE.InstancedMesh(treeGeo, treeMats, nTrees);
  let placed = 0;
  for (let i = 0; placed < nTrees && i < 1000; i++) {
    const a = Math.sin(i * 91.7) * Math.PI, r = 34 + Math.abs(Math.sin(i * 17.3)) * 70;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 31 && Math.abs(z) < 31) continue;
    const s = 0.8 + Math.abs(Math.sin(i * 5.7)) * 0.9;
    trees.setMatrixAt(placed++, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i, 0)), new THREE.Vector3(s, s, s)));
  }
  trees.count = placed;
  trees.castShadow = !low;
  group.add(trees);
  // barracks, a water tower and a flag just outside the walls
  const hutMat = std({ color: "#8c8f6a" }), hutRoof = std({ color: "#5b5e48", map: tiled(corr) });
  const hutGeos: THREE.BufferGeometry[] = [], roofGeos: THREE.BufferGeometry[] = [];
  for (const [x, z, rot] of [[-34, -10, 0], [-34, 6, 0], [36, -4, 0], [8, -36, Math.PI / 2], [-12, 37, Math.PI / 2]] as const) {
    const body = new THREE.BoxGeometry(12, 3.2, 6); body.translate(0, 1.6, 0); body.rotateY(rot); body.translate(x, 0, z); hutGeos.push(body);
    const roof = new THREE.CylinderGeometry(3.4, 3.4, 12.4, 3, 1); roof.rotateZ(Math.PI / 2); roof.rotateX(Math.PI / 6); roof.scale(1, 0.55, 1); roof.translate(0, 3.6, 0); roof.rotateY(rot); roof.translate(x, 0, z); roofGeos.push(roof);
  }
  group.add(merged(hutGeos, hutMat)!, merged(roofGeos, hutRoof)!);
  const tower = new THREE.Group();
  const legM = std({ color: "#6d7178", metalness: 0.4, roughness: 0.5 });
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10, 6), legM); l.position.set(x, 5, z); tower.add(l); }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4, 14), std({ color: "#c9cdd2", metalness: 0.3, roughness: 0.4 }));
  tank.position.y = 12; tower.add(tank);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.4, 14), std({ color: "#b84a35" }));
  cap.position.y = 14.7; tower.add(cap);
  tower.position.set(30, 0, 30);
  tower.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  group.add(tower);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 8), legM);
  pole.position.set(-27, 4.5, -27);
  const flagGeo = new THREE.PlaneGeometry(2.6, 1.6, 12, 4);
  const flag = new THREE.Mesh(flagGeo, std({ color: "#e05a2b", side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(-27 + 1.35, 8.1, -27);
  group.add(pole, flag);
  const flagBase = (flagGeo.attributes.position.array as Float32Array).slice();

  // a sign on the north wall, inside
  const signC = document.createElement("canvas"); signC.width = 1024; signC.height = 256;
  const sg = signC.getContext("2d")!;
  sg.fillStyle = "#2d3a2a"; sg.fillRect(0, 0, 1024, 256);
  sg.strokeStyle = "#f2c14e"; sg.lineWidth = 14; sg.strokeRect(10, 10, 1004, 236);
  sg.fillStyle = "#f4efe2"; sg.font = "bold 110px sans-serif"; sg.textAlign = "center"; sg.fillText("TRAINING YARD Z", 512, 165);
  const signTex = new THREE.CanvasTexture(signC); signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), std({ map: signTex, roughness: 0.7 }));
  sign.position.set(0, 2.2, -map.bounds.z1 + 0.02);
  const sign2 = sign.clone(); sign2.position.set(0, 2.2, map.bounds.z1 - 0.02); sign2.rotation.y = Math.PI;
  group.add(sign, sign2);

  return {
    group, ceilings: [], sun,
    update(t) {
      const p = flagGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = flagBase[i * 3] + 1.3;
        p.setZ(i, Math.sin(t * 5 - x * 2.2) * 0.14 * x);
      }
      p.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------------------------- spaceship
function buildShip(map: MapDef, scene: THREE.Scene, graphics: Graphics): MapView {
  const group = new THREE.Group();
  const low = graphics === "low";
  scene.background = new THREE.Color("#03050c");
  scene.fog = null;
  const H = map.ceiling;

  // ---- space outside: stars, a ringed planet, a moon, a distant sun
  const starGeo = new THREE.BufferGeometry();
  const nStars = low ? 900 : 2200;
  const sp = new Float32Array(nStars * 3);
  for (let i = 0; i < nStars; i++) {
    const u = Math.sin(i * 12.9898) * 43758.5453, v = Math.sin(i * 78.233) * 12345.678;
    const th = (u - Math.floor(u)) * Math.PI * 2, ph = Math.acos(2 * (v - Math.floor(v)) - 1);
    sp.set([Math.sin(ph) * Math.cos(th) * 500, Math.cos(ph) * 500, Math.sin(ph) * Math.sin(th) * 500], i * 3);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#dfe8ff", size: 1.6, sizeAttenuation: false, fog: false })));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 32), new THREE.MeshStandardMaterial({ map: TX.planetTex(), roughness: 1 }));
  planet.position.set(380, -70, 140);
  planet.rotation.z = 0.35;
  const ring = new THREE.Mesh(new THREE.RingGeometry(190, 260, 96), new THREE.MeshBasicMaterial({ color: "#e8cfa8", transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  ring.position.copy(planet.position);
  ring.rotation.set(-Math.PI / 2 + 0.35, 0.2, 0.35);
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(26, 3), new THREE.MeshStandardMaterial({ color: "#9aa3b5", flatShading: true, roughness: 1 }));
  moon.position.set(-360, 40, -160);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex("#fff4dc"), color: "#ffe9c7", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sunGlow.position.set(420, 160, -260);
  sunGlow.scale.setScalar(140);
  group.add(planet, ring, moon, sunGlow);
  // light: the distant sun shines through the windows (the only shadow caster) + interior fill
  const sun = sunLight("#fff1dc", 2.6, new THREE.Vector3(0.62, 0.42, -0.3).normalize(), 28, graphics);
  // planet bounce: warm fill from the planet side, cool fill from space
  group.add(sun, sun.target, new THREE.HemisphereLight("#e9f0ff", "#5a5f6b", 1.6));
  const planetLight = new THREE.DirectionalLight("#ffb488", 0.6);
  planetLight.position.set(1, -0.2, 0.4);
  group.add(planetLight);

  // ---- materials
  const panel = withAO(std({ map: tiled(TX.panelTex()), color: "#dde2e8", roughness: 0.55, metalness: 0.1 }), 0.4, 1.2, H);
  const panelUpper = withAO(std({ map: tiled(TX.panelTex()), color: "#c9cfd8", roughness: 0.55, metalness: 0.1 }), 0.25, 1, 7.5);
  const ceilingMat = std({ map: tiled(TX.panelTex()), color: "#aeb5bf", roughness: 0.6, metalness: 0.1, emissive: "#3a4049" });
  const trim = withAO(std({ color: "#3b414b", roughness: 0.5, metalness: 0.5 }));
  const accent = std({ color: "#ee7a2a", roughness: 0.45 });
  const lightStrip = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#eaf3ff", emissiveIntensity: 2.2 });
  const glass = new THREE.MeshStandardMaterial({ color: "#9fc3ff", transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.6, depthWrite: false });
  const crateOrange = withAO(std({ map: TX.crateTex(), color: "#ec7f35", roughness: 0.6 }));
  const crateWhite = withAO(std({ map: TX.crateTex(), color: "#e9edf1", roughness: 0.6 }));
  const crateTeal = withAO(std({ map: TX.crateTex(), color: "#3aa39b", roughness: 0.6 }));
  const hazard = std({ map: TX.hazardTex(), roughness: 0.6 });
  const screen = new THREE.MeshStandardMaterial({ color: "#0a1a24", emissive: "#3ad1e6", emissiveIntensity: 1.4 });

  const bucket = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const put = (m: THREE.Material, g: THREE.BufferGeometry) => { if (!bucket.has(m)) bucket.set(m, []); bucket.get(m)!.push(g); };
  const ceilGeos: THREE.BufferGeometry[] = [], stripGeos: THREE.BufferGeometry[] = [];

  // floor
  const plate = tiled(TX.floorPlateTex()); plate.repeat.set((map.bounds.x1 - map.bounds.x0) / 2, (map.bounds.z1 - map.bounds.z0) / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.bounds.x1 - map.bounds.x0, map.bounds.z1 - map.bounds.z0), std({ map: plate, color: "#c3cad4", roughness: 0.55, metalness: 0.12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  group.add(contactShadows(map.boxes));
  // hull underside, seen from outside (cutaway shots)
  const under = new THREE.Mesh(new THREE.BoxGeometry(map.bounds.x1 - map.bounds.x0 + 1.2, 1.2, map.bounds.z1 - map.bounds.z0 + 1.2), std({ color: "#5c636e", metalness: 0.4 }));
  under.position.y = -0.61;
  group.add(under);

  const windowWall = (o: Box) => {
    // solid bands below and above, frames every ~3 m, glass between: you see space through it
    const alongZ = o.z1 - o.z0 > o.x1 - o.x0;
    const len = alongZ ? o.z1 - o.z0 : o.x1 - o.x0;
    const lo = 1.0, hi = H - 0.9;
    put(panel, worldBox({ ...o, y1: lo }, 2));
    put(panel, worldBox({ ...o, y0: hi }, 2));
    put(accent, boxGeo({ ...o, y0: lo - 0.08, y1: lo, ...(alongZ ? { x0: o.x0 - 0.02, x1: o.x1 + 0.02 } : { z0: o.z0 - 0.02, z1: o.z1 + 0.02 }) }));
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const c = (alongZ ? o.z0 : o.x0) + (i * len) / n;
      const w = 0.3;
      put(trim, boxGeo(alongZ ? { x0: o.x0, x1: o.x1, y0: lo, y1: hi, z0: c - w / 2, z1: c + w / 2 } : { z0: o.z0, z1: o.z1, y0: lo, y1: hi, x0: c - w / 2, x1: c + w / 2 }));
    }
    const mid = alongZ ? (o.x0 + o.x1) / 2 : (o.z0 + o.z1) / 2;
    const g = new THREE.PlaneGeometry(len, hi - lo);
    if (alongZ) g.rotateY(Math.PI / 2);
    g.translate(alongZ ? mid : (o.x0 + o.x1) / 2, (lo + hi) / 2, alongZ ? (o.z0 + o.z1) / 2 : mid);
    put(glass, g);
  };

  for (const o of map.boxes) {
    const st = o.style;
    if (st === "window" || st === "window-end") windowWall(o);
    else if (st === "ceiling" || st === "ceiling-bay") {
      ceilGeos.push(worldBox(o, 2));
      // light strips under the ceiling
      const bay = st === "ceiling-bay";
      const alongZ = o.z1 - o.z0 >= o.x1 - o.x0;
      const len = alongZ ? o.z1 - o.z0 : o.x1 - o.x0, wid = alongZ ? o.x1 - o.x0 : o.z1 - o.z0;
      const rows = bay ? 3 : Math.max(1, Math.round(wid / 5));
      for (let r = 0; r < rows; r++) {
        const c = (alongZ ? o.x0 : o.z0) + ((r + 0.5) * wid) / rows;
        const s = { y0: o.y0 - 0.05, y1: o.y0 - 0.01 };
        const w = bay ? 0.8 : 0.28;
        stripGeos.push(boxGeo(alongZ ? { ...s, x0: c - w / 2, x1: c + w / 2, z0: o.z0 + 0.6, z1: o.z0 + len - 0.6 } : { ...s, z0: c - w / 2, z1: c + w / 2, x0: o.x0 + 0.6, x1: o.x0 + len - 0.6 }));
      }
    } else if (st === "bay-upper") put(panelUpper, worldBox(o, 2.5));
    else if (st === "bulkhead") {
      put(panel, worldBox(o, 2));
      // kick plate and an orange stripe on both faces
      const thinX = o.x1 - o.x0 < o.z1 - o.z0;
      const grow = thinX ? { x0: o.x0 - 0.015, x1: o.x1 + 0.015 } : { z0: o.z0 - 0.015, z1: o.z1 + 0.015 };
      put(trim, boxGeo({ ...o, ...grow, y0: 0, y1: 0.28 }));
      put(accent, boxGeo({ ...o, ...grow, y0: 1.95, y1: 2.07 }));
    } else if (st === "cargo" || st === "cargo-small") {
      const pick = Math.abs(Math.round(o.x0 * 7 + o.z0 * 3 + o.y0 * 5)) % 3;
      put(pick === 0 ? crateOrange : pick === 1 ? crateWhite : crateTeal, boxGeo(o));
    } else if (st === "cargo-long") {
      put(crateTeal, boxGeo({ ...o, y0: 0.15 }));
      put(trim, boxGeo({ ...o, y1: 0.15, x0: o.x0 - 0.05, x1: o.x1 + 0.05, z0: o.z0 - 0.05, z1: o.z1 + 0.05 }));
      for (const z of [o.z0 + 1, o.z1 - 1]) put(hazard, boxGeo({ x0: o.x0 - 0.01, x1: o.x1 + 0.01, y0: 0.15, y1: o.y1 + 0.01, z0: z - 0.1, z1: z + 0.1 }));
    } else if (st === "console") {
      put(trim, boxGeo({ ...o, y1: o.y1 - 0.12 }));
      put(screen, boxGeo({ ...o, y0: o.y1 - 0.12, x0: o.x0 + 0.08, x1: o.x1 - 0.08, z0: o.z0 + 0.08, z1: o.z1 - 0.08 }));
      put(trim, boxGeo({ ...o, y0: o.y1 - 0.12, y1: o.y1 - 0.06 }));
    } else if (st === "pillar") {
      put(trim, worldBox(o, 2));
      put(hazard, boxGeo({ x0: o.x0 - 0.01, x1: o.x1 + 0.01, z0: o.z0 - 0.01, z1: o.z1 + 0.01, y0: 0, y1: 0.6 }));
      put(lightStrip, boxGeo({ x0: o.x0 - 0.02, x1: o.x1 + 0.02, z0: o.z0 - 0.02, z1: o.z1 + 0.02, y0: 2.6, y1: 2.68 }));
    } else if (st === "pipes") {
      put(trim, boxGeo({ ...o, y1: 0.1 }));
      const alongZ = o.z1 - o.z0 > o.x1 - o.x0;
      const len = alongZ ? o.z1 - o.z0 : o.x1 - o.x0;
      for (let i = 0; i < 3; i++) {
        const c = new THREE.CylinderGeometry(0.13, 0.13, len, 10);
        if (alongZ) c.rotateX(Math.PI / 2); else c.rotateZ(Math.PI / 2);
        const off = (alongZ ? o.x0 : o.z0) + 0.15 + i * 0.25;
        c.translate(alongZ ? off : (o.x0 + o.x1) / 2, 0.25 + (i % 2) * 0.45, alongZ ? (o.z0 + o.z1) / 2 : off);
        put(i === 1 ? accent : trim, c);
      }
    } else put(panel, worldBox(o, 2));
  }
  // hazard stripes on the floor in every doorway: find gaps by sampling between bulkhead ends (cheap: mark spawn-room doors)
  for (const z of [16.8, -16.8]) for (const x of [-11, 0, 11]) {
    const g = new THREE.PlaneGeometry(2.2, 0.5); g.rotateX(-Math.PI / 2); g.translate(x, 0.013, z);
    put(hazard, g);
  }
  for (const [m, geos] of bucket) {
    const mesh = merged(geos, m, m !== glass && m !== lightStrip, m !== glass);
    if (mesh) { if (m === glass) mesh.renderOrder = 2; group.add(mesh); }
  }
  const ceil = merged(ceilGeos, ceilingMat, true, true)!;
  const strips = merged(stripGeos, lightStrip, false, false)!;
  group.add(ceil, strips);
  // warm work lights in the cargo bay (no shadows: cheap)
  if (!low) for (const [x, z] of [[-4.5, 0], [4.5, 0]]) { const p = new THREE.PointLight("#fff0d8", 18, 16, 1.6); p.position.set(x, 6.6, z); group.add(p); }

  return {
    group, ceilings: [ceil, strips], sun,
    update(t) {
      planet.rotation.y = t * 0.01;
      ring.rotation.z = 0.35 + t * 0.002;
    },
  };
}

function glowTex(color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, color); gr.addColorStop(0.25, "rgba(255,240,210,0.6)"); gr.addColorStop(1, "rgba(255,240,210,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildMap(map: MapDef, scene: THREE.Scene, look: Look, graphics: Graphics): MapView {
  if (look === "greybox") return buildGreybox(map, scene);
  return map.id === "base" ? buildBase(map, scene, graphics) : buildShip(map, scene, graphics);
}

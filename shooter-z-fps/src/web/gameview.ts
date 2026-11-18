// Draws a running match: the map, the robots (interpolated between ticks), x-ray outlines from the
// reveal rules, the first-person blaster, laser beams and sparks. Cameras: first person, a robot's POV,
// follow (over the shoulder), free fly and overview.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CLOAK_SEE_DIST, EYE_CROUCH, EYE_STAND, PROTECT_TICKS, RELOAD_TICKS, RUN_SPEED, SCAN_RANGE } from "../core/config";
import type { Game, GameEvent } from "../core/game";
import type { Match } from "../core/match";
import { Fx } from "./fx";
import { buildMap, type MapView } from "./mapview";
import { charactersLoaded, loadCharacterModels, makeRobot } from "./character";
import { CHARACTERS } from "../core/characters";

/** Friend-or-foe colours: teammates green, opponents red (markers, outlines, minimap). */
export const MATE_COLOR = "#3ddc84";
export const FOE_COLOR = "#ff4b3e";
const MATE = new THREE.Color(MATE_COLOR), FOE = new THREE.Color(FOE_COLOR);
import { restPose, type RobotPose, type RobotView } from "./robot";
import type { Look, Stage } from "./stage";

export type CamMode = "fp" | "pov" | "follow" | "free" | "overview";

export interface CameraRig {
  mode: CamMode;
  /** robot to follow / look through (pov, follow) */
  target: number;
  // free camera
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** mouse movement not yet applied to the core (first person: the camera turns at once) */
  pendingYaw: number; pendingPitch: number;
}

export const newRig = (): CameraRig => ({ mode: "fp", target: 0, x: 0, y: 12, z: 26, yaw: 0, pitch: -0.45, pendingYaw: 0, pendingPitch: 0 });

const SELF_LAYER = 1; // the first-person robot: casts a shadow, not seen by the camera

export class GameView {
  readonly stage: Stage;
  readonly match: Match;
  readonly map: MapView;
  readonly fx: Fx;
  readonly robots: RobotView[] = [];
  private spawnAt: number[]; private specialAt: number[]; private airSince: number[];
  private markers: THREE.Sprite[] = [];
  private prev: { x: number; y: number; z: number; yaw: number }[];
  private crouchS: number[];
  private shotAt: number[]; private hitAt: number[]; private deadAt: number[];
  /** who eliminated each robot last (for the death cam's highlight) */
  private killedBy: number[];
  /** death cam: the starting angle picked for the current death (one with a clear view of the robot) */
  private deathAng = 0;
  private deathKey = NaN;
  private colors: THREE.Color[];
  /** robot whose eyes we are in (first person / POV), or -1 */
  viewer = -1;
  /** the human's robot (gets the outline rules and the first-person blaster) */
  readonly self: number;
  private vmScene = new THREE.Scene();
  private vmRoot = new THREE.Group();
  private vmGun = new THREE.Group();
  private vmMuzzle = new THREE.Object3D();
  private vmKick = 0;
  private bob = 0;
  private time = 0;
  private shake = 0;
  /** where the overview camera orbits */
  private overviewA = 0;

  constructor(stage: Stage, match: Match, opts: { look: Look; self: number; colors: string[] }) {
    this.stage = stage;
    this.match = match;
    this.self = opts.self;
    const g = match.game;
    const scene = stage.scene;
    this.map = buildMap(g.map, scene, opts.look, stage.graphics);
    scene.add(this.map.group);
    if (this.map.sun) this.map.sun.shadow.camera.layers.enable(SELF_LAYER);
    this.fx = new Fx(stage.graphics === "low");
    scene.add(this.fx.group);
    this.colors = opts.colors.map((c) => new THREE.Color(c));
    const teams = g.agents.map((a) => a.team);
    this.addRobots(opts.colors);
    // rigged characters still loading (first match after the page opens): swap them in when ready
    if (!charactersLoaded()) {
      const sceneNow = scene;
      loadCharacterModels().then(() => {
        if (this.stage.scene !== sceneNow) return; // a new match has started since
        for (const r of this.robots) sceneNow.remove(r.root);
        this.robots.length = 0;
        this.addRobots(opts.colors);
      });
    }
    void teams;
    for (let i = 0; i < g.agents.length; i++) {
      // a marker arrow over the head: green over teammates (always), red over opponents only while
      // you can see them or they are revealed (hit, scan, standing still), never through walls otherwise
      const mk = new THREE.Sprite(new THREE.SpriteMaterial({ map: arrowTex(), color: FOE, depthTest: false, transparent: true, sizeAttenuation: false }));
      mk.scale.set(0.036, 0.036, 1); // a fixed size on screen, readable at any distance
      mk.renderOrder = 30;
      mk.visible = false;
      scene.add(mk);
      this.markers.push(mk);
    }
    this.prev = g.agents.map((a) => ({ x: a.x, y: a.y, z: a.z, yaw: a.yaw }));
    this.crouchS = g.agents.map(() => 0);
    this.shotAt = g.agents.map(() => -99);
    this.hitAt = g.agents.map(() => -99);
    this.deadAt = g.agents.map(() => NaN);
    this.killedBy = g.agents.map(() => -1);
    this.spawnAt = g.agents.map(() => -99);
    this.specialAt = g.agents.map(() => -99);
    this.airSince = g.agents.map(() => NaN);
    this.buildViewmodel(CHARACTERS[g.agents[Math.max(0, this.self)].character].accent); // your character's own colours
  }

  /** The robots (rigged characters where loaded, else stand-ins) and their x-ray copies. */
  private addRobots(colors: string[]): void {
    const scene = this.stage.scene;
    for (const a of this.match.game.agents) {
      // every character keeps its own art colours (no team tinting); friend or foe is shown by the markers
      const r = makeRobot(CHARACTERS[a.character].accent, this.stage.graphics === "normal", a.character, true);
      scene.add(r.root);
      this.robots.push(r);
      // no body outlines: friend or foe and reveals are shown only by the arrow over the head
    }
    // compile the robot shaders now, not on the first hit mid-fight
    this.stage.renderer.compile(scene, this.stage.camera);
  }

  private buildViewmodel(color: string): void {
    const c = new THREE.Color(color);
    const dark = new THREE.MeshStandardMaterial({ color: "#2a2f38", roughness: 0.5, metalness: 0.5 });
    const body = new THREE.MeshStandardMaterial({ color: "#e8ecf1", roughness: 0.4 });
    const col = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.5 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); this.vmGun.add(mesh); return mesh; };
    add(new RoundedBoxGeometry(0.075, 0.09, 0.34, 2, 0.02), dark, 0, 0, 0);
    add(new RoundedBoxGeometry(0.06, 0.03, 0.2, 2, 0.01), col, 0, 0.055, 0.02);
    add(new THREE.CylinderGeometry(0.02, 0.024, 0.2, 10).rotateX(Math.PI / 2), body, 0, 0.01, -0.26);
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 10).rotateX(Math.PI / 2), glow, 0, 0.01, -0.36);
    add(new RoundedBoxGeometry(0.05, 0.11, 0.06, 2, 0.015), dark, 0, -0.08, 0.08);
    add(new THREE.BoxGeometry(0.05, 0.012, 0.12), glow, 0.04, 0.005, -0.04);
    // glove on the grip
    add(new THREE.SphereGeometry(0.05, 10, 8), col, 0.0, -0.08, 0.1);
    this.vmMuzzle.position.set(0, 0.01, -0.38);
    this.vmGun.add(this.vmMuzzle);
    this.vmGun.position.set(0.2, -0.19, -0.42);
    this.vmGun.scale.setScalar(0.62);
    this.vmRoot.add(this.vmGun);
    this.vmScene.add(this.vmRoot, new THREE.HemisphereLight("#eef3ff", "#5a5048", 1.6));
    const key = new THREE.DirectionalLight("#fff3e0", 1.8);
    key.position.set(1, 2, 1);
    this.vmScene.add(key);
  }

  /** Call right before match.step(): remembers positions for interpolation. */
  snapshot(): void {
    for (const a of this.match.game.agents) {
      const p = this.prev[a.id];
      p.x = a.x; p.y = a.y; p.z = a.z; p.yaw = a.yaw;
    }
  }

  onEvents(events: readonly GameEvent[]): void {
    const g = this.match.game;
    for (const e of events) {
      if (e.type === "shot") {
        this.shotAt[e.a] = this.time;
        const from = this.muzzleOf(e.a);
        const to = new THREE.Vector3(e.x, e.y, e.z);
        this.fx.beam(from, to, this.colors[e.a], e.a === this.viewer ? 0.4 : 1);
        this.fx.flash(from, this.colors[e.a], 0.35, 0.06, e.a === this.viewer ? 0 : 2.5);
        if (e.target < 0 && e.surface > 0) {
          this.fx.flash(to, this.colors[e.a], 0.3, 0.25);
          this.fx.sparks(to, this.colors[e.a], 5, 2.5, 0.3);
        }
        if (e.a === this.viewer) this.vmKick = 1;
      } else if (e.type === "hit") {
        this.hitAt[e.v] = this.time;
        const p = new THREE.Vector3(e.x, e.y, e.z);
        const hot = new THREE.Color(e.blocked ? "#9fd8ff" : e.part === "head" ? "#ffd166" : "#ff9a3c");
        this.fx.sparks(p, hot, e.part === "head" ? 18 : 10, e.part === "head" ? 5 : 3.5);
        this.fx.flash(p, hot, e.part === "head" ? 0.6 : 0.4, 0.12);
        if (e.v === this.viewer) this.shake = Math.min(1, this.shake + 0.35);
      } else if (e.type === "kill") {
        this.deadAt[e.v] = this.time;
        this.killedBy[e.v] = e.a;
        const a = g.agents[e.v];
        const p = new THREE.Vector3(a.x, a.y + 1.1, a.z);
        this.fx.sparks(p, this.colors[e.v], 40, 6, 0.8);
        this.fx.sparks(p, new THREE.Color("#ffd9a0"), 20, 4, 0.6);
        this.fx.flash(p, this.colors[e.v], 2.2, 0.35, 6);
      } else if (e.type === "blocked") {
        const p = new THREE.Vector3(e.x, e.y, e.z);
        this.fx.sparks(p, new THREE.Color("#9fe0ff"), 10, 3);
        this.fx.flash(p, this.colors[e.v], 0.7, 0.15);
      } else if (e.type === "ability") {
        const a = g.agents[e.a];
        const p = new THREE.Vector3(a.x, a.y + 1, a.z);
        this.specialAt[e.a] = this.time;
        if (e.kind === "scan") this.fx.pulse(p, this.colors[e.a], SCAN_RANGE);
        else if (e.kind === "dash") { this.fx.sparks(new THREE.Vector3(a.x, a.y + 0.2, a.z), this.colors[e.a], 18, 3, 0.35); this.fx.flash(p, this.colors[e.a], 1.2, 0.2); }
        else if (e.kind === "cloak") this.fx.flash(p, this.colors[e.a], 1.6, 0.3);
      } else if (e.type === "spawn") {
        this.deadAt[e.a] = NaN;
        this.spawnAt[e.a] = this.time;
        this.specialAt[e.a] = -99;
        const a = g.agents[e.a];
        const p = this.prev[e.a];
        p.x = a.x; p.y = a.y; p.z = a.z; p.yaw = a.yaw; // no sliding across the map
        this.fx.flash(new THREE.Vector3(a.x, a.y + 1, a.z), this.colors[e.a], 2.5, 0.5);
      }
    }
  }

  private tmpV = new THREE.Vector3();
  /** World position of a robot's blaster tip (the first-person blaster for the viewer). */
  private muzzleOf(id: number): THREE.Vector3 {
    if (id === this.viewer) {
      this.vmRoot.updateMatrixWorld(true);
      return this.vmMuzzle.getWorldPosition(new THREE.Vector3());
    }
    const r = this.robots[id];
    r.root.updateMatrixWorld(true);
    return r.muzzle.getWorldPosition(new THREE.Vector3());
  }

  /** Interpolated position of a robot. */
  pos(id: number, alpha: number, out = this.tmpV): THREE.Vector3 {
    const a = this.match.game.agents[id], p = this.prev[id];
    return out.set(p.x + (a.x - p.x) * alpha, p.y + (a.y - p.y) * alpha, p.z + (a.z - p.z) * alpha);
  }

  render(alpha: number, dt: number, rig: CameraRig): void {
    this.time += dt;
    const g = this.match.game;
    const cam = this.stage.camera;
    this.viewer = rig.mode === "fp" ? this.self : rig.mode === "pov" ? rig.target : -1;
    const outlineViewer = rig.mode === "fp" ? this.self : rig.mode === "pov" ? rig.target : -1;
    // whose side the markers take: you, or the robot the spectator camera is on
    const markerViewer = rig.mode === "fp" ? this.self : rig.mode === "pov" || rig.mode === "follow" ? rig.target : -1;

    // ---- robots
    for (const a of g.agents) {
      const r = this.robots[a.id];
      const p = this.pos(a.id, alpha, new THREE.Vector3());
      const prevYaw = this.prev[a.id].yaw;
      let dy = a.yaw - prevYaw;
      if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
      r.root.position.copy(p);
      r.root.rotation.y = prevYaw + dy * alpha;
      this.crouchS[a.id] += ((a.crouch ? 1 : 0) - this.crouchS[a.id]) * Math.min(1, dt * 14);
      const pose: RobotPose = restPose();
      pose.t = this.time;
      pose.speed = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
      // velocity in the robot's frame (it faces -Z at yaw 0): forward and to its right
      const yaw = r.root.rotation.y;
      pose.fwd = -a.vx * Math.sin(yaw) - a.vz * Math.cos(yaw);
      pose.side = a.vx * Math.cos(yaw) - a.vz * Math.sin(yaw);
      if (a.grounded || !a.alive) this.airSince[a.id] = NaN;
      else if (Number.isNaN(this.airSince[a.id])) this.airSince[a.id] = this.time;
      pose.airAge = Number.isNaN(this.airSince[a.id]) ? 0 : this.time - this.airSince[a.id];
      pose.spawnAge = this.time - this.spawnAt[a.id];
      pose.specialAge = this.time - this.specialAt[a.id];
      pose.crouch = this.crouchS[a.id];
      pose.pitch = a.pitch;
      pose.airborne = !a.grounded;
      pose.shotAge = this.time - this.shotAt[a.id];
      pose.hitAge = this.time - this.hitAt[a.id];
      pose.deadAge = a.alive ? NaN : this.time - this.deadAt[a.id];
      if (!a.alive && Number.isNaN(this.deadAt[a.id])) pose.deadAge = 5; // dead before we started watching
      pose.protected = a.alive && a.protectTicks > 0;
      pose.shield = a.alive && a.ability === "shield" && a.abilityTicks > 0;
      if (a.alive && g.cloaked(a)) {
        // cloaked: a faint shimmer, clearer up close; your own team (and spectators) see a ghost of it
        const friendly = outlineViewer < 0 || g.agents[outlineViewer].team === a.team;
        const d = cam.position.distanceTo(p);
        pose.visibility = friendly ? 0.3 : d < CLOAK_SEE_DIST ? 0.22 : 0.05 + 0.03 * Math.sin(this.time * 7);
      } else pose.visibility = 1;
      r.pose(pose);
      // first person: our own robot only casts its shadow (shown again on the death cam)
      const hidden = a.id === this.viewer && a.alive;
      for (const m of r.meshes) m.layers.set(hidden ? SELF_LAYER : 0);
      // marker arrow
      const mk = this.markers[a.id];
      let show = false, mate = false;
      if (markerViewer >= 0 && a.alive && a.id !== markerViewer) {
        const v = g.agents[markerViewer];
        mate = a.team === v.team;
        if (mate) show = true;
        else {
          const revealed = a.outlineFor[markerViewer] > 0 || a.revealTicks > 0 || a.scanFor[v.team] > 0;
          // death cam: the robot that got you keeps its red arrow until you respawn
          const killer = !v.alive && this.killedBy[markerViewer] === a.id;
          show = revealed || killer || (v.alive && this.canSee(v, a));
        }
      }
      mk.visible = show;
      if (show) {
        mk.position.set(p.x, p.y + (a.crouch ? 1.75 : 2.25) + Math.sin(this.time * 4) * 0.04, p.z);
        mk.material.color.copy(mate ? MATE : FOE);
      }
    }

    // ---- camera
    const sh = this.shake;
    this.shake = Math.max(0, this.shake - dt * 3);
    const eyesId = rig.mode === "fp" ? this.self : rig.mode === "pov" ? rig.target : -1;
    if (eyesId >= 0 && !g.agents[eyesId].alive) {
      // death cam: pull back and circle your own robot as it goes down, then respawn into first person
      const a = g.agents[eyesId];
      const p = this.pos(eyesId, 1, new THREE.Vector3());
      const age = Number.isNaN(this.deadAt[eyesId]) ? 1.5 : this.time - this.deadAt[eyesId];
      const k = Math.min(1, age / 1.2), ease = 1 - (1 - k) * (1 - k);
      const head = new THREE.Vector3(p.x, p.y + 1.2, p.z);
      if (this.deathKey !== this.deadAt[eyesId]) {
        // pick a starting angle where the camera ends up in the open with the fallen robot in view
        this.deathKey = this.deadAt[eyesId];
        this.deathAng = a.yaw + 0.5;
        for (let k = 0; k < 12; k++) {
          const ang = a.yaw + 0.5 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 6);
          const cx = p.x - Math.sin(ang + 0.6) * 4.8, cz = p.z - Math.cos(ang + 0.6) * 4.8, cy = p.y + 2.9;
          const dx = cx - head.x, dy = cy - head.y, dz = cz - head.z, l = Math.hypot(dx, dy, dz);
          const room = g.world.raycast(head.x, head.y, head.z, dx / l, dy / l, dz / l, l);
          if (room > 3.5 && g.world.clear(cx, cy, cz, p.x, p.y + 0.35, p.z)) { this.deathAng = ang; break; }
        }
      }
      const ang = this.deathAng + Math.min(age, 2.5) * 0.25; // starts near the front of the robot, slowly circles
      const r = 1.6 + ease * 3.2, h = 1.0 + ease * 1.9;
      const want = new THREE.Vector3(p.x - Math.sin(ang) * r, p.y + h, p.z - Math.cos(ang) * r);
      const d = new THREE.Vector3().subVectors(want, head);
      const len = d.length();
      d.divideScalar(len);
      const t = g.world.raycast(head.x, head.y, head.z, d.x, d.y, d.z, len);
      cam.position.copy(head).addScaledVector(d, Math.max(0.5, t - 0.3));
      cam.lookAt(p.x, p.y + 0.5, p.z);
      this.vmGun.visible = false;
    } else if (rig.mode === "fp" || rig.mode === "pov") {
      const id = rig.mode === "fp" ? this.self : rig.target;
      const a = g.agents[id];
      const p = this.pos(id, alpha, new THREE.Vector3());
      const eye = EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouchS[id];
      const speed = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
      this.bob += dt * speed * 1.9 * (a.grounded ? 1 : 0);
      const bobY = Math.sin(this.bob * 2) * 0.025 * Math.min(1, speed / RUN_SPEED);
      cam.position.set(p.x, p.y + eye + bobY, p.z);
      const yaw = a.yaw + (rig.mode === "fp" ? rig.pendingYaw : 0), pitch = Math.max(-1.45, Math.min(1.45, a.pitch + (rig.mode === "fp" ? rig.pendingPitch : 0)));
      cam.rotation.set(pitch + (Math.random() - 0.5) * sh * 0.02, yaw + (Math.random() - 0.5) * sh * 0.02, 0);
      // blaster: sway with movement, kick on each shot, dip while reloading
      this.vmKick = Math.max(0, this.vmKick - dt * 9);
      const reload = a.reloadTicks > 0 ? Math.sin((1 - a.reloadTicks / RELOAD_TICKS) * Math.PI) : 0;
      this.vmGun.position.set(0.15 + Math.cos(this.bob) * 0.008 * Math.min(1, speed / RUN_SPEED), -0.14 + bobY * 0.4 - reload * 0.08 - this.crouchS[id] * 0.01, -0.3 + this.vmKick * 0.03);
      this.vmGun.rotation.set(this.vmKick * 0.09 + reload * 0.5, 0, reload * 0.5);
      this.vmGun.visible = a.alive;
    } else if (rig.mode === "follow") {
      const a = g.agents[rig.target];
      const p = this.pos(rig.target, alpha, new THREE.Vector3());
      const yaw = this.robots[rig.target].root.rotation.y;
      const back = 2.6, up = 1.9, side = 0.7;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const want = new THREE.Vector3(p.x - fx * back + rx * side, p.y + up, p.z - fz * back + rz * side);
      // keep the camera out of walls: pull it in along the line to the robot
      const head = new THREE.Vector3(p.x, p.y + 1.6, p.z);
      const d = new THREE.Vector3().subVectors(want, head);
      const len = d.length();
      d.divideScalar(len);
      const t = g.world.raycast(head.x, head.y, head.z, d.x, d.y, d.z, len);
      want.copy(head).addScaledVector(d, Math.max(0.4, t - 0.25));
      if (!a.alive) want.y += 0.5;
      cam.position.lerp(want, Math.min(1, dt * 8));
      cam.lookAt(p.x + fx * 6, p.y + 1.3 + Math.sin(a.pitch) * 3, p.z + fz * 6);
    } else if (rig.mode === "free") {
      cam.position.set(rig.x, rig.y, rig.z);
      cam.rotation.set(rig.pitch, rig.yaw, 0);
    } else {
      this.overviewA += dt * 0.08;
      const b = g.map.bounds, r = Math.max(b.x1 - b.x0, b.z1 - b.z0) * 0.62;
      cam.position.set(Math.sin(this.overviewA) * r, r * 0.75, Math.cos(this.overviewA) * r);
      cam.lookAt(0, 0, 0);
    }
    // ceilings: hidden in the overview so you can see inside the ship
    for (const c of this.map.ceilings) c.visible = rig.mode !== "overview";

    this.fx.update(dt);
    this.map.update(this.time);
    const r = this.stage.renderer;
    r.autoClear = true;
    this.stage.render();
    if ((rig.mode === "fp" || rig.mode === "pov") && this.vmGun.visible) {
      // the blaster draws on top (never clips into walls)
      this.vmRoot.position.copy(cam.position);
      this.vmRoot.quaternion.copy(cam.quaternion);
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, cam);
      r.autoClear = true;
    }
  }

  /** Can robot v see robot a right now (line of sight to its head or chest; cloaked ones only up close)? */
  private canSee(v: Game["agents"][number], a: Game["agents"][number]): boolean {
    const g = this.match.game;
    const ex = v.x, ey = g.eyeY(v), ez = v.z;
    const dx = a.x - ex, dz = a.z - ez;
    if (g.cloaked(a) && dx * dx + dz * dz > CLOAK_SEE_DIST * CLOAK_SEE_DIST) return false;
    const h = a.crouch ? 0.69 : 1;
    return g.world.clear(ex, ey, ez, a.x, a.y + 1.6 * h, a.z) || g.world.clear(ex, ey, ez, a.x, a.y + 1.15 * h, a.z);
  }

  /** Protection fraction for the HUD (1 = just spawned). */
  protection(id: number): number {
    return this.match.game.agents[id].protectTicks / PROTECT_TICKS;
  }
}

let ARROW: THREE.CanvasTexture | null = null;
/** A downward arrow (white, tinted green or red by the sprite), with a dark edge so it reads on any background. */
function arrowTex(): THREE.CanvasTexture {
  if (ARROW) return ARROW;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.strokeStyle = "rgba(0,0,0,0.65)";
  g.lineWidth = 5;
  g.lineJoin = "round";
  g.beginPath(); g.moveTo(8, 12); g.lineTo(56, 12); g.lineTo(32, 54); g.closePath();
  g.stroke(); g.fill();
  ARROW = new THREE.CanvasTexture(c);
  return ARROW;
}

export type { Game };

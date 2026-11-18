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
import { RobotModel, restPose, type RobotPose } from "./robot";
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
  readonly robots: RobotModel[] = [];
  private xray: THREE.Mesh[][] = [];
  private markers: THREE.Sprite[] = [];
  private prev: { x: number; y: number; z: number; yaw: number }[];
  private crouchS: number[];
  private shotAt: number[]; private hitAt: number[]; private deadAt: number[];
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
    for (const a of g.agents) {
      const r = new RobotModel(opts.colors[a.id], stage.graphics === "normal", a.character);
      scene.add(r.root);
      this.robots.push(r);
      // x-ray copy of every part: drawn through walls when the reveal rules say so
      const xm = new THREE.MeshBasicMaterial({ color: this.colors[a.id], transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
      const list: THREE.Mesh[] = [];
      for (const m of r.meshes) {
        const x = new THREE.Mesh(m.geometry, xm);
        x.renderOrder = 20;
        x.visible = false;
        m.add(x);
        list.push(x);
      }
      this.xray.push(list);
      // teammate marker (2v2): a small diamond over the head, always visible
      const isMate = this.self >= 0 && a.id !== this.self && teams[a.id] === teams[this.self];
      const mk = new THREE.Sprite(new THREE.SpriteMaterial({ map: diamondTex(), color: this.colors[a.id], depthTest: false, transparent: true }));
      mk.scale.setScalar(0.32);
      mk.renderOrder = 30;
      mk.visible = isMate;
      scene.add(mk);
      this.markers.push(mk);
    }
    this.prev = g.agents.map((a) => ({ x: a.x, y: a.y, z: a.z, yaw: a.yaw }));
    this.crouchS = g.agents.map(() => 0);
    this.shotAt = g.agents.map(() => -99);
    this.hitAt = g.agents.map(() => -99);
    this.deadAt = g.agents.map(() => NaN);
    this.buildViewmodel(opts.colors[Math.max(0, this.self)]);
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
        if (e.kind === "scan") this.fx.pulse(p, this.colors[e.a], SCAN_RANGE);
        else if (e.kind === "dash") { this.fx.sparks(new THREE.Vector3(a.x, a.y + 0.2, a.z), this.colors[e.a], 18, 3, 0.35); this.fx.flash(p, this.colors[e.a], 1.2, 0.2); }
        else if (e.kind === "cloak") this.fx.flash(p, this.colors[e.a], 1.6, 0.3);
      } else if (e.type === "spawn") {
        this.deadAt[e.a] = NaN;
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
      // first person: our own robot only casts its shadow
      const hidden = a.id === this.viewer;
      for (const m of r.meshes) m.layers.set(hidden ? SELF_LAYER : 0);
      // x-ray: outlined for the viewer after a hit, revealed when idle, teammates always
      let xr = false;
      if (outlineViewer >= 0 && a.alive && a.id !== outlineViewer) {
        const mate = a.team === g.agents[outlineViewer].team;
        xr = mate || a.outlineFor[outlineViewer] > 0 || a.revealTicks > 0 || a.scanFor[g.agents[outlineViewer].team] > 0;
        if (mate && g.cloaked(a)) xr = false;
      }
      const pulse = 0.38 + 0.14 * Math.sin(this.time * 10);
      for (const x of this.xray[a.id]) { x.visible = xr; (x.material as THREE.MeshBasicMaterial).opacity = pulse; }
      const mk = this.markers[a.id];
      if (mk.visible) mk.position.set(p.x, p.y + 2.25, p.z);
      if (mk.visible) mk.material.opacity = a.alive ? 0.95 : 0;
    }

    // ---- camera
    const sh = this.shake;
    this.shake = Math.max(0, this.shake - dt * 3);
    if (rig.mode === "fp" || rig.mode === "pov") {
      const id = rig.mode === "fp" ? this.self : rig.target;
      const a = g.agents[id];
      const p = this.pos(id, alpha, new THREE.Vector3());
      const eye = EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouchS[id];
      const speed = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
      this.bob += dt * speed * 1.9 * (a.grounded ? 1 : 0);
      const bobY = Math.sin(this.bob * 2) * 0.025 * Math.min(1, speed / RUN_SPEED);
      cam.position.set(p.x, p.y + eye + bobY + (a.alive ? 0 : -1.0), p.z);
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

  /** Protection fraction for the HUD (1 = just spawned). */
  protection(id: number): number {
    return this.match.game.agents[id].protectTicks / PROTECT_TICKS;
  }
}

let DIAMOND: THREE.CanvasTexture | null = null;
function diamondTex(): THREE.CanvasTexture {
  if (DIAMOND) return DIAMOND;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(54, 30); g.lineTo(32, 58); g.lineTo(10, 30); g.closePath();
  g.stroke(); g.fill();
  DIAMOND = new THREE.CanvasTexture(c);
  return DIAMOND;
}

export type { Game };

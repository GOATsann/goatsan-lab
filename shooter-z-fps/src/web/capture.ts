// Capture page: renders one scene at a given time, frame-exact, for filming the build stages.
//   /capture.html?scene=map&map=base&look=greybox&w=1920&h=1080&dur=6
// window.capture.frame(t) draws the frame at time t (seconds); test/tools/capture.mjs screenshots each one.
import * as THREE from "three";
import { getMap, type MapId } from "../core/maps";
import { buildMap } from "./mapview";
import { makePrimitiveRobot, restPose, RobotModel } from "./robot";
import type { SkillName } from "../core/bot";
import type { Mode } from "../core/game";
import { Match, standardSlots } from "../core/match";
import { GameView, newRig, type CamMode } from "./gameview";
import { Hud, type HudContext } from "./hud";
import { Stage, type Look } from "./stage";

const q = new URLSearchParams(location.search);
const W = Number(q.get("w") ?? 1920), H = Number(q.get("h") ?? 1080), DUR = Number(q.get("dur") ?? 6);
const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const stage = new Stage(canvas, { graphics: "normal", width: W, height: H, preserve: true });
const scene = q.get("scene") ?? "map";

type Frame = (t: number) => void;
/** A simple studio: soft floor, key + fill light, for the robot design clips. */
function studio(): void {
  const s = stage.scene;
  s.background = new THREE.Color("#1f2430");
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: "#2c3341", roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  s.add(floor);
  s.add(new THREE.HemisphereLight("#cfe0ff", "#2a2f3a", 1.2));
  const key = new THREE.DirectionalLight("#fff1dc", 2.6);
  key.position.set(2.5, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2; key.shadow.camera.right = 2; key.shadow.camera.top = 3; key.shadow.camera.bottom = -1;
  s.add(key);
  const rim = new THREE.DirectionalLight("#7fb2ff", 1.4);
  rim.position.set(-3, 2.5, -3);
  s.add(rim);
}

const scenes: Record<string, () => Promise<Frame>> = {
  // a deterministic match (bots only): fast-forward to tick t0, then play with a camera.
  //   mode, map, seed, skill, skill0 (robot 0's level), t0, cam=fp|pov|follow|overview|orbit, target, hud=1, label=1
  async match() {
    const mode = (q.get("mode") ?? "duel") as Mode;
    const seed = Number(q.get("seed") ?? 1);
    const skill = (q.get("skill") ?? "normal") as SkillName;
    const slots = standardSlots(mode, skill, { spectate: true, seed });
    if (q.get("skill0")) slots[0].skill = q.get("skill0") as SkillName;
    if (q.get("char0")) slots[0].character = Number(q.get("char0"));
    if (q.get("youName")) slots[0].name = q.get("youName")!;
    const match = new Match(seed, { map: (q.get("map") ?? "base") as MapId, mode, scoreLimit: Number(q.get("limit") ?? 10), slots });
    const colors = mode === "team" ? ["#3d8bff", "#2fc9b5", "#ff8a2a", "#e2503f"] : mode === "duel" ? ["#3d8bff", "#ff8a2a"] : ["#3d8bff", "#ff8a2a", "#7bd04b", "#d65ad8"];
    const camMode = (q.get("cam") ?? "follow") as CamMode | "orbit";
    const target = Number(q.get("target") ?? 0);
    const fp = camMode === "fp";
    const view = new GameView(stage, match, { look: "final", self: fp ? target : -1, colors });
    const rig = newRig();
    rig.mode = camMode === "orbit" ? "free" : camMode;
    rig.target = target;
    const t0 = Number(q.get("t0") ?? 0);
    while (match.tick < t0 && !match.over) { view.snapshot(); match.step(); }
    view.onEvents([]);
    const showHud = q.get("hud") === "1";
    const hud = showHud ? new Hud(document.body, false) : null;
    const label = q.get("label") === "1" ? Object.assign(document.createElement("div"), { className: "cap-label" }) : null;
    if (label) document.body.appendChild(label);
    const ctx = (): HudContext => ({ game: match.game, slots, colors, self: target, spectator: !fp });
    let lastT = 0;
    const FPS = 30;
    return (t) => {
      const dt = t - lastT;
      lastT = t;
      const want = t0 + Math.round(t * 60);
      while (match.tick < want && !match.over) {
        view.snapshot();
        match.step();
        view.onEvents(match.game.events);
        hud?.onEvents(match.game.events, ctx());
      }
      if (camMode === "orbit") {
        // slow orbit around the target robot
        const a = match.game.agents[target];
        const ang = 0.6 + t * 0.35, r = 7;
        rig.x = a.x + Math.sin(ang) * r; rig.z = a.z + Math.cos(ang) * r; rig.y = 4.2;
        rig.yaw = Math.atan2(rig.x - a.x, rig.z - a.z); rig.pitch = -0.42;
      }
      view.render(1, dt > 0 ? dt : 1 / FPS, rig);
      if (hud) {
        const cam = stage.camera;
        hud.update(dt > 0 ? dt : 1 / FPS, ctx(), (x, y, z) => {
          const v = new THREE.Vector3(x, y, z).project(cam);
          if (v.z > 1) return null;
          return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
        }, cam.rotation.y);
      }
      if (label) {
        const b = match.bots[target];
        const st = b ? b.state : "";
        const names: Record<string, string> = { patrol: "Patrolling", hunt: "Hunting a lead", engage: "Engaging", cover: "Taking cover", regroup: "Regrouping" };
        label.innerHTML = `${q.get("title") ?? slots[target].name}<small>${names[st] ?? st}</small>`;
      }
    };
  },
  // a big number on screen (the headless speed result)
  async number() {
    const d = document.createElement("div");
    d.className = "cap-big";
    d.innerHTML = `<b>${q.get("n") ?? ""}</b><span>${q.get("line") ?? ""}</span><small>${q.get("small") ?? ""}</small>`;
    document.body.appendChild(d);
    return () => {};
  },
  // robot design stages on a turntable: stage=primitive|model, or anim=idle|run|shoot|hit|eliminated
  async robot() {
    studio();
    const color = q.get("color") ?? "#3d8bff";
    const anim = q.get("anim");
    const model = q.get("stage") === "primitive" ? null : new RobotModel(color);
    stage.scene.add(model ? model.root : makePrimitiveRobot(color));
    const portrait = H > W;
    const spin = anim ? 0.25 : 0.6;
    return (t) => {
      if (model) {
        const p = restPose();
        p.t = t;
        if (anim === "run") { p.speed = 6; model.root.position.z = 0; }
        if (anim === "shoot") { p.shotAge = (t % 0.4); p.pitch = 0.05; }
        if (anim === "hit") { p.hitAge = t % 0.9; }
        if (anim === "crouch") { p.crouch = Math.min(1, Math.max(0, Math.sin(t * 1.6) * 1.4 + 0.5)); }
        if (anim === "eliminated") { p.deadAge = t - 1; p.hitAge = t - 1 >= 0 ? t - 1 : Infinity; }
        if (anim === "protected") p.protected = true;
        model.pose(p);
      }
      const a = (anim ? -0.6 : 0.5) + t * spin;
      const r = portrait ? 2.5 : 2.9;
      stage.camera.position.set(Math.sin(a) * r, 1.35, Math.cos(a) * r);
      stage.camera.lookAt(0, 0.95, 0);
      stage.render();
    };
  },
  // slow orbit over the map (turntable)
  async map() {
    const map = getMap((q.get("map") ?? "base") as MapId);
    const view = buildMap(map, stage.scene, (q.get("look") ?? "final") as Look, "normal");
    stage.scene.add(view.group);
    if (q.get("cutaway") !== "0") for (const c of view.ceilings) c.visible = false;
    const portrait = H > W;
    const b = map.bounds;
    const size = Math.max(b.x1 - b.x0, b.z1 - b.z0);
    const a0 = Number(q.get("a0") ?? 0.6);
    return (t) => {
      const a = a0 + (t / DUR) * 1.1;
      const r = size * (portrait ? 0.85 : 0.6), h = size * (portrait ? 0.7 : 0.48);
      stage.camera.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
      stage.camera.lookAt(0, 0, 0);
      view.update(t);
      stage.render();
    };
  },
};

const frame = await scenes[scene]();
(window as unknown as { capture: { frame: Frame; ready: boolean; THREE: typeof THREE } }).capture = { frame, ready: true, THREE };
frame(0);

// The heads-up display: crosshair + hit markers (headshots look different), health, ammo, score,
// kill feed, minimap (pings, reveals, teammates), damage direction, scoreboard (Tab), messages.
import * as C from "../core/config";
import type { Game, GameEvent } from "../core/game";
import { MODES } from "../core/game";
import type { Slot } from "../core/match";
import { CHARACTERS } from "../core/characters";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface HudContext {
  game: Game;
  slots: Slot[];
  colors: string[];
  /** the robot whose view the HUD shows (-1 = free camera / overview) */
  self: number;
  spectator: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private cross: HTMLElement;
  private hit: HTMLElement;
  private health: HTMLElement; private healthBar: HTMLElement; private healthNum: HTMLElement;
  private ammo: HTMLElement; private ammoNum: HTMLElement; private reloadBar: HTMLElement;
  private score: HTMLElement;
  private feed: HTMLElement;
  private mini: HTMLCanvasElement;
  private dmg: HTMLElement;
  private center: HTMLElement;
  private board: HTMLElement;
  private toast: HTMLElement;
  private fps: HTMLElement | null;
  private specBar: HTMLElement;
  private abil: HTMLElement;
  private hitT = -1; private hitKind = ""; private toastT = -9;
  /** who eliminated the HUD's robot last (shown on the death cam) */
  private killer: { name: string; color: string; head: boolean } | null = null;
  private dmgArcs: { el: HTMLElement; yawW: number; t: number }[] = [];
  private numbers: { el: HTMLElement; t: number; x: number; y: number; z: number }[] = [];
  private now = 0;
  private frames: number[] = [];
  showBoard = false;

  constructor(parent: HTMLElement, debugFps: boolean) {
    this.root = el("div", "hud", parent);
    this.cross = el("div", "cross", this.root, "<i></i><i></i><i></i><i></i><b></b>");
    this.hit = el("div", "hitm", this.root, "<i></i><i></i><i></i><i></i>");
    this.health = el("div", "health", this.root, `<span class="lbl">Health</span><div class="bar"><div></div></div><b>100</b>`);
    this.healthBar = this.health.querySelector(".bar div")!;
    this.healthNum = this.health.querySelector("b")!;
    this.ammo = el("div", "ammo", this.root, `<span class="lbl">Laser</span><b>24</b><small>/ ${C.CLIP}</small><div class="rl"><div></div></div>`);
    this.ammoNum = this.ammo.querySelector("b")!;
    this.reloadBar = this.ammo.querySelector(".rl div")!;
    this.score = el("div", "score", this.root);
    this.feed = el("div", "feed", this.root);
    this.mini = el("canvas", "mini", this.root) as HTMLCanvasElement;
    this.mini.width = this.mini.height = 360;
    this.dmg = el("div", "dmg", this.root);
    this.center = el("div", "center", this.root);
    this.toast = el("div", "toast", this.root);
    this.board = el("div", "board", this.root);
    this.specBar = el("div", "specbar", this.root);
    this.abil = el("div", "abil", this.root, `<div class="ring"><div class="fill"></div><span class="key">E</span></div><div class="txt"><b></b><small></small></div>`);
    this.fps = debugFps ? el("div", "fps", this.root) : null;
  }

  setVisible(v: boolean): void { this.root.style.display = v ? "" : "none"; }

  /** Things that happened this tick, seen from robot `self`. */
  onEvents(events: readonly GameEvent[], ctx: HudContext): void {
    const g = ctx.game;
    for (const e of events) {
      if (e.type === "hit" && e.a === ctx.self && !ctx.spectator) {
        this.hitT = this.now;
        this.hitKind = e.kill ? "kill" : e.blocked ? "blocked" : e.part === "head" ? "head" : "body";
        if (!e.blocked) this.damageNumber(Math.round(e.dmg), e.x, e.y + 0.3, e.z, e.part === "head");
      }
      if (e.type === "hit" && e.v === ctx.self && !e.blocked) {
        const a = g.agents[e.a];
        this.damageArc(Math.atan2(-(a.x - g.agents[e.v].x), -(a.z - g.agents[e.v].z)));
      }
      if (e.type === "kill") this.killFeed(e, ctx);
      if (e.type === "kill" && e.v === ctx.self) this.killer = { name: ctx.slots[e.a].name, color: ctx.colors[e.a], head: e.part === "head" };
      if (e.type === "reveal" && e.a === ctx.self && !ctx.spectator) this.say("You stood still too long: everyone can see you. Move!", 2.5);
      if (e.type === "blocked" && e.a === ctx.self && !ctx.spectator) { this.hitT = this.now; this.hitKind = "blocked"; }
      if (e.type === "blocked" && e.v === ctx.self && !ctx.spectator) this.say("Shield blocked a laser", 0.8);
    }
  }

  private say(text: string, secs: number): void {
    this.toast.textContent = text;
    this.toastT = this.now + secs;
  }

  private killFeed(e: Extract<GameEvent, { type: "kill" }>, ctx: HudContext): void {
    const row = el("div", "kf", undefined, `<b style="color:${ctx.colors[e.a]}">${esc(ctx.slots[e.a].name)}</b><span class="gun">${e.part === "head" ? "&#x2316; headshot" : "&#x2014;&#x2014;"}</span><b style="color:${ctx.colors[e.v]}">${esc(ctx.slots[e.v].name)}</b>`);
    if (e.a === ctx.self || e.v === ctx.self) row.classList.add("me");
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => row.classList.add("old"), 5000);
    setTimeout(() => row.remove(), 5600);
    if (e.a === ctx.self && !ctx.spectator) this.say(e.part === "head" ? `Headshot! You eliminated ${ctx.slots[e.v].name}` : `You eliminated ${ctx.slots[e.v].name}`, 1.8);
  }

  private damageArc(yawW: number): void {
    const a = el("div", "arc", this.dmg);
    this.dmgArcs.push({ el: a, yawW, t: this.now });
  }

  private damageNumber(n: number, x: number, y: number, z: number, head: boolean): void {
    const d = el("div", head ? "num head" : "num", this.root, String(n));
    this.numbers.push({ el: d, t: this.now, x, y, z });
  }

  /** Every frame. `project` maps a world point to screen pixels (or null when behind the camera). */
  update(dt: number, ctx: HudContext, project: (x: number, y: number, z: number) => { x: number; y: number } | null, camYaw: number): void {
    this.now += dt;
    const g = ctx.game;
    const me = ctx.self >= 0 ? g.agents[ctx.self] : null;
    const firstPerson = !!me && !ctx.spectator;
    this.root.classList.toggle("spectating", !firstPerson);
    this.root.classList.toggle("dead", !!me && !me.alive);
    // crosshair: opens up with movement / air (shows the real spread)
    if (me) {
      const hs = Math.sqrt(me.vx * me.vx + me.vz * me.vz) / C.RUN_SPEED;
      let spread = C.SPREAD_BASE + C.SPREAD_MOVE * Math.min(1, hs) + (me.grounded ? 0 : C.SPREAD_AIR);
      if (me.crouch) spread *= C.SPREAD_CROUCH_MULT;
      this.cross.style.setProperty("--gap", `${4 + spread * 700}px`);
    }
    // hit marker
    const ha = this.now - this.hitT;
    this.hit.className = `hitm ${ha < 0.25 ? "on " + this.hitKind : ""}`;
    // health / ammo
    if (me) {
      const h = Math.max(0, me.health);
      this.healthNum.textContent = String(Math.ceil(h));
      this.healthBar.style.width = `${h}%`;
      this.health.classList.toggle("low", h < 35);
      this.ammoNum.textContent = String(me.ammo);
      this.ammo.classList.toggle("empty", me.ammo === 0);
      this.reloadBar.style.width = me.reloadTicks > 0 ? `${(1 - me.reloadTicks / C.RELOAD_TICKS) * 100}%` : "0%";
      this.ammo.classList.toggle("reloading", me.reloadTicks > 0);
    }
    // ability: ready / active / cooling down
    if (me) {
      const ch = CHARACTERS[me.character];
      const ready = me.abilityCooldown === 0;
      const active = me.abilityTicks > 0 && ch.ability !== "scan";
      this.abil.classList.toggle("ready", ready);
      this.abil.classList.toggle("active", active);
      (this.abil.querySelector(".fill") as HTMLElement).style.setProperty("--p", String(ready ? 1 : 1 - me.abilityCooldown / ch.cooldown));
      this.abil.querySelector("b")!.textContent = ch.name === ch.abilityName ? ch.name : `${ch.name}: ${ch.abilityName}`;
      this.abil.querySelector("small")!.textContent = active ? "active" : ready ? "ready (E or right-click)" : `${Math.ceil(me.abilityCooldown / C.TICK_HZ)} s`;
    }
    // centre message
    let msg = "";
    if (me && !me.alive && !g.over) {
      const who = this.killer ? `Eliminated by <b style="color:${this.killer.color}">${esc(this.killer.name)}</b>${this.killer.head ? " (headshot)" : ""}<br>` : "";
      msg = `${who}<small>Respawning in ${Math.ceil(me.respawnTicks / C.TICK_HZ)}</small>`;
    } else if (me && me.protectTicks > 0 && firstPerson) msg = "Spawn shield (ends when you fire)";
    else if (me && firstPerson && me.idleTicks > C.IDLE_REVEAL_AFTER - 4 * C.TICK_HZ) msg = `Standing still: revealed in ${Math.ceil((C.IDLE_REVEAL_AFTER - me.idleTicks) / C.TICK_HZ)}`;
    if (this.center.innerHTML !== msg) this.center.innerHTML = msg;
    this.toast.classList.toggle("on", this.now < this.toastT);
    // score
    this.score.innerHTML = this.scoreHtml(ctx);
    // damage arcs
    for (const d of this.dmgArcs) {
      const age = this.now - d.t;
      d.el.style.opacity = String(Math.max(0, 1 - age / 1.4));
      d.el.style.transform = `translate(-50%, -50%) rotate(${-(d.yawW - camYaw)}rad)`;
    }
    this.dmgArcs = this.dmgArcs.filter((d) => (this.now - d.t < 1.4 ? true : (d.el.remove(), false)));
    // damage numbers float up
    for (const n of this.numbers) {
      const age = this.now - n.t;
      const p = project(n.x, n.y + age * 0.8, n.z);
      if (!p) { n.el.style.opacity = "0"; continue; }
      n.el.style.opacity = String(Math.max(0, 1 - age / 0.8));
      n.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
    this.numbers = this.numbers.filter((n) => (this.now - n.t < 0.8 ? true : (n.el.remove(), false)));
    this.drawMinimap(ctx, camYaw);
    this.board.style.display = this.showBoard || g.over ? "" : "none";
    if (this.showBoard || g.over) this.board.innerHTML = this.boardHtml(ctx);
    if (this.fps) {
      this.frames.push(dt);
      if (this.frames.length > 60) this.frames.shift();
      const avg = this.frames.reduce((s, x) => s + x, 0) / this.frames.length;
      const worst = Math.max(...this.frames);
      this.fps.textContent = `${Math.round(1 / avg)} fps · ${(avg * 1000).toFixed(1)} ms avg · ${(worst * 1000).toFixed(1)} ms worst`;
    }
  }

  setSpectatorBar(html: string): void { this.specBar.innerHTML = html; }

  private teamName(t: number, ctx: HudContext): string {
    if (ctx.game.options.mode !== "team") return ctx.slots[ctx.game.agents.findIndex((a) => a.team === t)].name;
    return t === 0 ? "Blue team" : "Orange team";
  }

  private scoreHtml(ctx: HudContext): string {
    const g = ctx.game, lim = g.options.scoreLimit;
    const mode = g.options.mode;
    if (mode === "ffa") {
      const order = [...g.agents].sort((a, b) => b.kills - a.kills || a.id - b.id);
      return `<div class="lim">First to ${lim}</div>` + order.map((a) => `<span class="pill${a.id === ctx.self ? " me" : ""}" style="--c:${ctx.colors[a.id]}">${esc(ctx.slots[a.id].name)} <b>${a.kills}</b></span>`).join("");
    }
    const teams = MODES[mode].teams;
    const tColor = (t: number) => ctx.colors[teams.indexOf(t)];
    return `<div class="lim">First to ${lim}</div><span class="pill big" style="--c:${tColor(0)}">${esc(this.teamName(0, ctx))} <b>${g.teamScore[0]}</b></span><span class="vs">vs</span><span class="pill big" style="--c:${tColor(1)}"><b>${g.teamScore[1]}</b> ${esc(this.teamName(1, ctx))}</span>`;
  }

  private boardHtml(ctx: HudContext): string {
    const g = ctx.game;
    const rows = (list: typeof g.agents) => list.map((a) => {
      const acc = a.shots ? Math.round((100 * a.hits) / a.shots) : 0;
      return `<tr class="${a.id === ctx.self ? "me" : ""}"><td><i style="background:${ctx.colors[a.id]}"></i>${esc(ctx.slots[a.id].name)} <small class="ch">${CHARACTERS[a.character].name}</small>${ctx.slots[a.id].kind === "bot" ? ` <small>AI ${ctx.slots[a.id].skill}</small>` : ""}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${acc}%</td><td>${a.headshots}</td></tr>`;
    }).join("");
    const head = `<tr><th>Robot</th><th>Elims</th><th>Deaths</th><th>Accuracy</th><th>Headshots</th></tr>`;
    let body: string;
    if (g.options.mode === "team") {
      body = [0, 1].map((t) => `<tr class="team"><td colspan="5">${this.teamName(t, ctx)}: ${g.teamScore[t]}</td></tr>` + rows(g.agents.filter((a) => a.team === t).sort((a, b) => b.kills - a.kills))).join("");
    } else body = rows([...g.agents].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths));
    let title = "Scoreboard";
    if (g.over) {
      const win = g.winnerTeam;
      if (ctx.spectator || ctx.self < 0) title = `${this.teamName(win, ctx)} wins`;
      else title = g.agents[ctx.self].team === win ? "Victory! You beat the AI." : "Defeat. The AI wins this one.";
    }
    return `<h2>${title}</h2><table>${head}${body}</table>${g.over ? `<p class="hint">${ctx.spectator ? "Next match starts in a moment" : "Press Enter to play again, Esc for the menu"}</p>` : ""}`;
  }

  private drawMinimap(ctx: HudContext, camYaw: number): void {
    const cv = this.mini, g2 = cv.getContext("2d")!;
    const g = ctx.game;
    const S = cv.width, R = S / 2;
    const me = ctx.self >= 0 ? g.agents[ctx.self] : null;
    const scale = me ? 6 : S / (Math.max(g.map.bounds.x1 - g.map.bounds.x0, g.map.bounds.z1 - g.map.bounds.z0) + 4); // px per metre
    const cx = me ? me.x : 0, cz = me ? me.z : 0;
    const rot = me ? camYaw : 0;
    g2.clearRect(0, 0, S, S);
    g2.save();
    g2.beginPath(); g2.arc(R, R, R - 2, 0, Math.PI * 2); g2.clip();
    g2.fillStyle = "rgba(14,18,26,0.72)"; g2.fillRect(0, 0, S, S);
    g2.translate(R, R);
    g2.rotate(rot); // forward is up
    g2.scale(scale, scale);
    g2.translate(-cx, -cz);
    for (const b of g.map.boxes) {
      if (b.y0 > 2 || b.style.startsWith("ceiling")) continue;
      g2.fillStyle = b.kind === 2 ? "rgba(214,190,140,0.75)" : "rgba(200,208,220,0.85)";
      g2.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    }
    const dot = (x: number, z: number, color: string, r: number, ring = false) => {
      g2.beginPath(); g2.arc(x, z, r / scale, 0, Math.PI * 2);
      if (ring) { g2.strokeStyle = color; g2.lineWidth = 3 / scale; g2.stroke(); } else { g2.fillStyle = color; g2.fill(); }
    };
    for (const a of g.agents) {
      if (!a.alive) continue;
      if (me && a.id === me.id) continue;
      const isMate = me ? a.team === me.team : true;
      if (!me || ctx.spectator) { dot(a.x, a.z, ctx.colors[a.id], 9); continue; }
      if (isMate) { dot(a.x, a.z, ctx.colors[a.id], 8); continue; }
      if (a.outlineFor[me.id] > 0 || a.revealTicks > 0 || a.scanFor[me.team] > 0) { dot(a.x, a.z, ctx.colors[a.id], 8); dot(a.x, a.z, "#fff", 14, true); continue; }
      if (a.pingTicks > 0) {
        const k = a.pingTicks / C.PING_TICKS;
        g2.globalAlpha = k;
        dot(a.pingX, a.pingZ, ctx.colors[a.id], 8);
        dot(a.pingX, a.pingZ, ctx.colors[a.id], 10 + (1 - k) * 22, true);
        g2.globalAlpha = 1;
      }
    }
    g2.restore();
    // you: an arrow in the middle
    if (me) {
      g2.save();
      g2.translate(R, R);
      g2.fillStyle = ctx.colors[me.id]; g2.strokeStyle = "#fff"; g2.lineWidth = 3;
      g2.beginPath(); g2.moveTo(0, -16); g2.lineTo(11, 12); g2.lineTo(0, 6); g2.lineTo(-11, 12); g2.closePath(); g2.fill(); g2.stroke();
      g2.restore();
    }
    g2.strokeStyle = "rgba(255,255,255,0.35)"; g2.lineWidth = 3;
    g2.beginPath(); g2.arc(R, R, R - 2, 0, Math.PI * 2); g2.stroke();
  }
}

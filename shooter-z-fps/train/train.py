"""Train the Shooter Z AI: RecurrentPPO (PPO with an LSTM, sb3-contrib) with or without a curriculum.

    cd shooter-z-fps && ../car-racing/.venv/bin/python train/train.py --run-name A-curriculum --curriculum
    ... --run-name B-selfplay                               # straight into self-play
    ... --timesteps 5e6 --servers 5 --matches 16            # a short local test

Curriculum (A): still targets (spawned in view at 5, 10, 20 m, then normal spawns) -> moving targets
(10 m, then normal) -> bots Easy -> Normal -> Hard -> self-play. A stage is passed on its own servers'
last 200 matches (targets: hit rate >= 50% and win rate >= 90%; bots: win rate >= 60%); a stage that
takes longer than its time cap (--stage-cap of the budget; a quarter of that for the close-spawn
stages) is passed anyway (logged).
During a stage, 1 of the 5 servers replays the previous stage (so it doesn't forget).
Self-play: 4 servers play the current policy against itself (both robots learn; 3 with --selfplay-bots,
then 1 plays heuristic bots at a random level per match), 1 server plays a frozen snapshot from the pool (a snapshot is saved every --snapshot-every steps). The reward's helper
terms (damage, enemy on screen) fade from 100% to 0% over the second half of the self-play steps.
Every --eval-every steps: 32 deterministic matches against Normal bots -> progress.csv (learning curves).
"""

import argparse
import collections
import copy
import csv
import json
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import RecurrentPPO
from stable_baselines3.common.callbacks import BaseCallback

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from szenv import MultiShooterVecEnv, ShooterVecEnv, load_reward  # noqa: E402
from szpolicy import POLICY_KWARGS, Encoder, load_model  # noqa: E402,F401

MAX_TICKS = 60 * 60 * 3  # training cut-off: 3 minutes of game time (truncation, not a loss)
EVAL_SEED = 777_000
STAGES = [  # (name, handshake for the stage's servers, pass rule, time cap as a share of --stage-cap)
    # targets first appear close and in view (target_distance), then farther, then at normal spawns
    ("still-5m", {"opponent": "still", "options": {"target_distance": 5}}, "targets", 0.25),
    ("still-10m", {"opponent": "still", "options": {"target_distance": 10}}, "targets", 0.25),
    ("still-20m", {"opponent": "still", "options": {"target_distance": 20}}, "targets", 0.25),
    ("still", {"opponent": "still"}, "targets", 1),
    ("moving-10m", {"opponent": "moving", "options": {"opponent_skill": "normal", "target_distance": 10}}, "targets", 0.25),
    ("moving", {"opponent": "moving", "options": {"opponent_skill": "normal"}}, "targets", 1),
    ("bot-easy", {"opponent": "bot", "options": {"opponent_skill": "easy"}}, "bots", 1),
    ("bot-normal", {"opponent": "bot", "options": {"opponent_skill": "normal"}}, "bots", 1),
    ("bot-hard", {"opponent": "bot", "options": {"opponent_skill": "hard"}}, "bots", 1),
    ("self-play", None, None, None),
]


class GameServers:
    """Start N Node game servers on consecutive ports; stop them on exit."""

    def __init__(self, n: int, port0: int, log_dir: Path):
        self.procs, self.ports = [], list(range(port0, port0 + n))
        tsx = ROOT / "node_modules" / ".bin" / "tsx"
        log_dir.mkdir(parents=True, exist_ok=True)
        logs = [log_dir / f"server-{p}.log" for p in self.ports]
        for port, log in zip(self.ports, logs):
            with log.open("w") as f:
                self.procs.append(subprocess.Popen([str(tsx), "src/headless/server.ts", "--port", str(port)], cwd=ROOT, stdout=f, stderr=subprocess.STDOUT))
        deadline = time.time() + 60
        for p, log in zip(self.procs, logs):
            while "batch server on" not in log.read_text():
                if p.poll() is not None or time.time() > deadline:
                    self.stop()
                    raise RuntimeError(f"game server did not start, see {log}")
                time.sleep(0.1)

    def stop(self) -> None:
        for p in self.procs:
            p.terminate()
        for p in self.procs:
            p.wait(timeout=10)


class Snapshot:
    """A frozen copy of the policy that plays robot 1 ("frozen" opponent)."""

    def __init__(self, policy, path: Path):
        self.policy = copy.deepcopy(policy)
        self.policy.load_state_dict(torch.load(path, map_location="cpu"))
        self.policy.set_training_mode(False)
        self.name = path.stem

    def predict(self, obs, state=None, episode_start=None, deterministic=False):
        return self.policy.predict(obs, state=state, episode_start=episode_start, deterministic=deterministic)


class DetSnapshot(Snapshot):
    """A frozen snapshot that always plays its best action (for benchmarks)."""

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        return self.policy.predict(obs, state=state, episode_start=episode_start, deterministic=True)


class Trainer(BaseCallback):
    """Curriculum, self-play league, helper fade, logging, snapshots and progress evaluation."""

    def __init__(self, args, run_dir: Path, ports: list[int], eval_port: int, reward):
        super().__init__()
        self.args, self.run_dir, self.ports, self.eval_port, self.reward = args, run_dir, ports, eval_port, reward
        self.stage = 0 if args.curriculum else len(STAGES) - 1
        self.stage_started = 0
        self.selfplay_started = 0 if not args.curriculum else None
        self.recent = collections.defaultdict(lambda: collections.deque(maxlen=200))  # per stage name
        self.rollout_ends: list[dict] = []
        self.terms = collections.Counter()
        self.decisions = 0
        self.next_snapshot = args.snapshot_every
        self.next_eval = 0
        self.pool: list[Path] = []
        if args.init_policy:  # the starting weights are the first opponent in the pool (e.g. A@28M)
            self.pool.append(Path(args.init_policy))
        self.vs_snapshot = collections.defaultdict(lambda: collections.deque(maxlen=50))  # snapshot -> [(kills, deaths)]
        self.ref = None  # fixed reference opponent for the progress benchmark (--ref-policy)
        (run_dir / "snapshots").mkdir(parents=True, exist_ok=True)
        self.log = (run_dir / "stages.csv").open("a", newline="")
        self.stage_log = csv.writer(self.log)

    # ---- which servers play what ----------------------------------------------------------------
    def specs(self) -> list[dict]:
        a, n = self.args, self.args.matches
        seed = lambda k: 1_000_000 + 10_000_000 * k + self.num_timesteps  # noqa: E731 (fresh tracks after every switch)
        base = lambda k: {"port": self.ports[k], "seed_base": seed(k), "max_ticks": MAX_TICKS, "reward": self.reward}  # noqa: E731
        name, cfg, _, _ = STAGES[self.stage]
        if cfg is not None:  # a curriculum stage: 4 servers on it, 1 on the previous stage (or also on it)
            prev = STAGES[max(0, self.stage - 1)][1]
            out = []
            for k in range(a.servers):
                c = prev if (k == a.servers - 1 and self.stage > 0) else cfg
                out.append({**base(k), "n_envs": n, "opponent": c["opponent"], "options": c.get("options", {}), "stage": STAGES[self.stage - 1][0] if c is prev and self.stage > 0 else name})
            return out
        # self-play: the first servers play the current policy against itself; with --selfplay-bots one server
        # plays heuristic bots (a random level per match, so it keeps beating them); the last one frozen snapshots
        n_bots = 1 if a.selfplay_bots else 0
        out = [{**base(k), "n_envs": n // 2, "opponent": "self", "stage": "self-play"} for k in range(a.servers - 1 - n_bots)]
        if n_bots:
            k = a.servers - 2
            out.append({**base(k), "n_envs": n, "opponent": "bot", "options": {"opponent_skill": "random"}, "stage": "self-play bots"})
        frozen = self.pick_snapshot()
        out.append({**base(a.servers - 1), "n_envs": n, "opponent": "frozen" if frozen else "self", "frozen": frozen,
                    "stage": f"vs {frozen.name}" if frozen else "self-play", **({} if frozen else {"n_envs": n // 2})})
        return out

    def pick_snapshot(self):
        """Prioritized pick (PFSP "hard", as in AlphaStar): weight (1 - p)^2, p = the current model's kill share
        against that snapshot so far (prior 1:1). Snapshots it still struggles with get most matches; ones it
        crushes fade out. Weights use recent results (the last 50 matches per snapshot)."""
        if not self.pool:
            return None
        weights = []
        for path in self.pool:
            r = self.vs_snapshot.get(path.stem, [])
            k, d = sum(x[0] for x in r), sum(x[1] for x in r)
            p = (k + 1) / (k + d + 2)
            weights.append((1 - p) ** 2 + 1e-3)
        path = random.choices(self.pool, weights=weights)[0]
        return Snapshot(self.model.policy, path)

    def env_specs(self):
        out = []
        for s in self.specs():
            s = dict(s)
            s.pop("stage")
            out.append(s)
        return out

    def restore(self, t: int) -> None:
        """Continue a finished run: its stage, self-play start and snapshot pool, from stages.csv and snapshots/."""
        rows = [r for r in csv.reader((self.run_dir / "stages.csv").open()) if r]
        names = [s[0] for s in STAGES]
        last = rows[-1]
        self.stage = names.index(last[1]) + (1 if last[2] != "start" else 0)
        self.stage_started = int(last[0])
        sp = [int(r[0]) for r in rows if r[1] == "self-play" and r[2] == "start"]
        self.selfplay_started = sp[0] if sp else None
        self.pool = ([Path(self.args.init_policy)] if self.args.init_policy else []) + sorted((self.run_dir / "snapshots").glob("policy_*.pt"))
        last_snap = int(self.pool[-1].stem.split("_")[1]) if self.pool else 0
        self.next_snapshot = last_snap + self.args.snapshot_every
        self.next_eval = t + self.args.eval_every
        self.resuming = True

    # ---- SB3 hooks ----------------------------------------------------------------------------------
    def _on_training_start(self) -> None:
        self.training_env.ramp_scale = float(np.clip(self.num_timesteps / max(1, self.args.ramp_end), 0, 1))
        if getattr(self, "resuming", False):
            self.switch()  # the servers play the restored stage (and a snapshot from the pool)
            return
        self.write_stage("start")

    def _on_step(self) -> bool:
        self.decisions += len(self.locals["infos"])
        for i, info in enumerate(self.locals["infos"]):
            self.terms.update(info["reward_terms"])
            if "episode_end" in info:
                e = info["episode_end"]
                self.rollout_ends.append(e)
                if e.get("snapshot"):
                    self.vs_snapshot[e["snapshot"]].append((e["kills"], e["deaths"]))
                self.recent[self.server_stage(i)].append(e)
        return True

    def server_stage(self, agent: int) -> str:
        env = self.training_env
        k = int(np.searchsorted(env._cuts, agent, side="right") - 1)
        return self.current_stages[k]

    def _on_rollout_end(self) -> None:
        L = self.logger
        for name, total in self.terms.items():
            L.record(f"reward/{name}", total / max(self.decisions, 1))
        if self.rollout_ends:
            e = self.rollout_ends
            kills, deaths = sum(x["kills"] for x in e), sum(x["deaths"] for x in e)
            L.record("episode/win_rate", np.mean([x["won"] for x in e]))
            L.record("episode/kd", kills / max(deaths, 1))
            L.record("episode/hit_rate", sum(x["hits"] for x in e) / max(sum(x["shots"] for x in e), 1))
            L.record("episode/headshot_share", sum(x["headshots"] for x in e) / max(sum(x["hits"] for x in e), 1))
            L.record("episode/damage_per_min", sum(x["damageDealt"] for x in e) / max(sum(x["minutes"] for x in e), 1e-9))
            L.record("episode/cut_off_share", np.mean([x["cut_off"] for x in e]))
            mins = max(sum(x["minutes"] for x in e), 1e-9)
            for k in ("crouchToggles", "jumps", "strafeReversals", "turnReversals", "abilities",
                      "crouchSpam", "jumpSpam", "strafeJitter", "turnJitter", "abilityWasted"):
                L.record(f"moves/{k}_per_min", sum(x.get(k, 0) for x in e) / mins)
            for opp in sorted({x["opponent"] for x in e}):  # e.g. the bot server in self-play
                sub = [x for x in e if x["opponent"] == opp]
                L.record(f"episode/win_rate_{opp}", np.mean([x["won"] for x in sub]))
        L.record("train/stage", self.stage)
        L.record("league/pool_size", len(self.pool))
        L.record("train/helper_scale", self.training_env.helper_scale)
        L.record("train/ramp_scale", self.training_env.ramp_scale)
        self.terms.clear(); self.rollout_ends.clear(); self.decisions = 0

        t = self.num_timesteps
        if t >= self.next_snapshot:  # the league grows
            path = self.run_dir / "snapshots" / f"policy_{t:010d}.pt"
            torch.save(self.model.policy.state_dict(), path)
            self.pool.append(path)
            self.next_snapshot += self.args.snapshot_every
        if t >= self.next_eval:
            self.evaluate()
            self.next_eval += self.args.eval_every
        changed = self.maybe_advance()
        if self.selfplay_started is not None:  # helper terms fade over the second half of self-play
            span = max(1, self.args.fade_end - self.selfplay_started)
            frac = (t - self.selfplay_started) / span
            self.training_env.helper_scale = float(np.clip(2 - 2 * frac, 0, 1))
        self.training_env.ramp_scale = float(np.clip(t / max(1, self.args.ramp_end), 0, 1))  # wasted-move costs grow in
        if changed:
            self.switch()  # a new stage: every server restarts
        elif STAGES[self.stage][1] is None and self.pool:
            self.refresh_league()

    def maybe_advance(self) -> bool:
        name, cfg, rule, _ = STAGES[self.stage]
        if cfg is None:
            return False
        r = list(self.recent[name])
        t = self.num_timesteps
        budget = self.args.stage_cap * STAGES[self.stage][3] * self.args.timesteps
        passed = False
        if len(r) >= 200:
            win = np.mean([x["won"] for x in r])
            hit = sum(x["hits"] for x in r) / max(sum(x["shots"] for x in r), 1)
            passed = (win >= 0.9 and hit >= 0.5) if rule == "targets" else win >= 0.6
        capped = t - self.stage_started > budget
        if passed or capped:
            self.write_stage("passed" if passed else "time cap")
            self.stage += 1
            self.stage_started = t
            if STAGES[self.stage][1] is None:
                self.selfplay_started = t
            return True
        return False

    def refresh_league(self) -> None:
        """Self-play: the last server plays frozen snapshots. The first time the pool has one, that server
        alone switches from self-play to 'frozen' (its matches restart once). After that, on 25% of updates a
        new snapshot is queued, and each of its matches takes it when it ends. No other match is cut short."""
        env, k = self.training_env, self.args.servers - 1
        last = env.envs[k]
        if last.opponent != "frozen":
            frozen = self.pick_snapshot()
            spec = {"port": self.ports[k], "seed_base": 1_000_000 + 10_000_000 * k + self.num_timesteps, "max_ticks": MAX_TICKS,
                    "reward": self.reward, "n_envs": self.args.matches, "opponent": "frozen", "frozen": frozen}
            obs = env.reconfigure_one(k, spec)
            a, b = env._cuts[k], env._cuts[k + 1]
            self.model._last_obs[a:b] = obs
            self.model._last_episode_starts[a:b] = True
            self.current_stages[k] = f"vs {frozen.name}"
        elif random.random() < 0.25:
            frozen = self.pick_snapshot()
            last.queue_frozen(frozen)
            self.current_stages[k] = "vs snapshots"

    def switch(self) -> None:
        env = self.training_env
        specs = self.specs()
        self.current_stages = [s["stage"] for s in specs]
        obs = env.reconfigure([{k: v for k, v in s.items() if k != "stage"} for s in specs])
        # every agent starts a new match: fresh observations, LSTM memory reset
        self.model._last_obs = obs
        self.model._last_episode_starts = np.ones((env.num_envs,), dtype=bool)
        if self.stage != getattr(self, "_logged_stage", None):
            self.write_stage("start")

    def write_stage(self, event: str) -> None:
        r = list(self.recent[STAGES[self.stage][0]])
        win = float(np.mean([x["won"] for x in r])) if r else None
        self.stage_log.writerow([self.num_timesteps, STAGES[self.stage][0], event, win])
        self.log.flush()
        self._logged_stage = self.stage
        print(f"[stage] {self.num_timesteps:,} steps: {STAGES[self.stage][0]} {event}" + (f" (win rate {win:.0%})" if win is not None else ""), flush=True)

    def evaluate(self) -> None:
        """32 deterministic matches against Normal bots on fixed seeds (a fixed yardstick), and with
        --ref-policy 64 against that fixed reference model (the main measure in AI-only self-play)
        -> progress.csv (learning curves)."""
        res = play_matches(self.model.policy, self.eval_port, "normal", 32, EVAL_SEED, MAX_TICKS)
        row = {"steps": self.num_timesteps, "minutes": round((time.time() - self.started) / 60, 1), "stage": STAGES[self.stage][0], **res}
        if self.args.ref_policy:
            if self.ref is None:
                self.ref = DetSnapshot(self.model.policy, Path(self.args.ref_policy))
            rec: list = []
            ref = play_matches(self.model.policy, self.eval_port, "policy", 64, EVAL_SEED, MAX_TICKS, opponent_policy=self.ref, records=rec)
            k, d = sum(x["kills"] for x in rec), sum(x["deaths"] for x in rec)
            row |= {"ref_win_rate": ref["win_rate"], "ref_loss_rate": float(np.mean([x["lost"] for x in rec])), "ref_kill_share": k / max(k + d, 1)}
            self.logger.record("eval/kill_share_vs_ref", row["ref_kill_share"])
            print(f"[eval] {self.num_timesteps:,} steps: vs {self.ref.name} kill share {row['ref_kill_share']:.0%}, "
                  f"won {row['ref_win_rate']:.0%}, lost {row['ref_loss_rate']:.0%}", flush=True)
        path = self.run_dir / "progress.csv"
        new = not path.exists()
        with path.open("a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(row))
            if new:
                w.writeheader()
            w.writerow(row)
        self.logger.record("eval/win_rate_vs_normal", res["win_rate"])
        print(f"[eval] {self.num_timesteps:,} steps ({row['stage']}): vs Normal bots win {res['win_rate']:.0%}, "
              f"K/D {res['kd']:.2f}, headshots {res['headshot_share']:.0%}, damage/min {res['damage_per_min']:.0f}", flush=True)


def play_matches(policy, port: int, skill: str, n: int, seed0: int, max_ticks: int, opponent_policy=None, records: list | None = None) -> dict:
    """n deterministic matches (fixed seeds) of `policy` against `skill` bots, or against another policy
    (opponent_policy, skill = 'policy'). Returns win rate, K/D, hit rate, headshot share, damage/min."""
    if opponent_policy is not None:
        env = ShooterVecEnv(port, n, opponent="frozen", frozen=opponent_policy, seed_base=seed0, max_ticks=max_ticks)
    else:
        env = ShooterVecEnv(port, n, opponent="bot", options={"opponent_skill": skill}, seed_base=seed0, max_ticks=max_ticks)
    obs = np.stack([env.set_seed(i, seed0 + i)[0] for i in range(n)])
    if opponent_policy is not None:
        env._last_obs = np.concatenate([np.stack([obs[i], env.set_seed(i, seed0 + i)[1]]) for i in range(n)])
        env.frozen_start = np.ones(n, dtype=bool)
    state, start = None, np.ones(n, dtype=bool)
    results: dict[int, dict] = {}
    while len(results) < n:
        act, state = policy.predict(obs, state=state, episode_start=start, deterministic=True)
        obs, _, done, infos = env.step(act)
        start = done
        for i in np.flatnonzero(done):
            if i not in results:
                results[i] = infos[i]["episode_end"]
    env.close()
    e = [results[i] for i in range(n)]
    if records is not None:
        records.extend(e)
    kills, deaths = sum(x["kills"] for x in e), sum(x["deaths"] for x in e)
    return {
        "win_rate": float(np.mean([x["won"] for x in e])), "kd": kills / max(deaths, 1),
        "hit_rate": sum(x["hits"] for x in e) / max(sum(x["shots"] for x in e), 1),
        "headshot_share": sum(x["headshots"] for x in e) / max(sum(x["hits"] for x in e), 1),
        "damage_per_min": sum(x["damageDealt"] for x in e) / max(sum(x["minutes"] for x in e), 1e-9),
        "cut_off_share": float(np.mean([x["cut_off"] for x in e])),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run-name", required=True)
    p.add_argument("--curriculum", action="store_true", help="run A: targets -> bots -> self-play")
    p.add_argument("--timesteps", type=float, default=100e6)
    p.add_argument("--servers", type=int, default=5)
    p.add_argument("--matches", type=int, default=16, help="matches per server (even: self-play uses half)")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--port", type=int, default=7500)
    p.add_argument("--snapshot-every", type=float, default=2e6)
    p.add_argument("--eval-every", type=float, default=2e6)
    p.add_argument("--stage-cap", type=float, default=0.12, help="max share of the budget per curriculum stage")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--resume", action="store_true", help="continue runs/<run-name> from its final.zip up to --timesteps (total); "
                   "the old final.zip is kept as checkpoint_<steps>.zip")
    p.add_argument("--selfplay-bots", action="store_true", help="in self-play, 1 of the 5 servers plays heuristic bots (random level per match)")
    p.add_argument("--ref-policy", type=Path, help="fixed reference opponent for the progress benchmark (a policy_<steps>.pt)")
    p.add_argument("--init-policy", type=Path, help="start from these weights (a snapshots/policy_<steps>.pt); without --curriculum it goes straight to self-play")
    p.add_argument("--ramp-end", type=float, default=None, help="step at which the ramp terms (wasted-move costs) reach full weight (default: 80%% of --timesteps)")
    p.add_argument("--fade-end", type=float, default=None, help="step at which the helper rewards reach 0 (default: --timesteps)")
    args = p.parse_args()
    args.timesteps, args.snapshot_every, args.eval_every = int(args.timesteps), int(args.snapshot_every), int(args.eval_every)
    args.fade_end = int(args.fade_end) if args.fade_end else args.timesteps
    args.ramp_end = int(args.ramp_end) if args.ramp_end else int(0.8 * args.timesteps)

    torch.set_num_threads(args.threads)
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    run_dir = ROOT / "runs" / args.run_name
    if args.resume:  # the run keeps its own reward and curriculum flag
        old = json.loads((run_dir / "meta.json").read_text())
        args.curriculum = old["args"]["curriculum"]
        reward = load_reward(run_dir / "reward.json")
    else:
        run_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(HERE / "reward.json", run_dir / "reward.json")
        reward = load_reward(HERE / "reward.json")

    servers = GameServers(args.servers + 1, args.port, run_dir / "logs")  # +1 for evaluation
    try:
        trainer_ports, eval_port = servers.ports[:-1], servers.ports[-1]
        # the first stage's servers (A: still targets everywhere; B: self-play everywhere, no pool yet)
        first = STAGES[0][1] if args.curriculum else None
        specs = [({"port": pt, "n_envs": args.matches, "opponent": first["opponent"], "options": first.get("options", {})} if first
                  else {"port": pt, "n_envs": args.matches // 2, "opponent": "self"})
                 | {"seed_base": 1_000_000 + 10_000_000 * k, "max_ticks": MAX_TICKS, "reward": reward} for k, pt in enumerate(trainer_ports)]
        env = MultiShooterVecEnv(specs)
        if args.resume:
            model = load_model(run_dir / "final.zip", env=env)
            model.tensorboard_log = str(run_dir / "tb")
            keep = run_dir / f"checkpoint_{model.num_timesteps}.zip"
            if not keep.exists():
                shutil.copy(run_dir / "final.zip", keep)
            print(f"[resume] from {model.num_timesteps:,} steps to {args.timesteps:,}; kept {keep.name}", flush=True)
        else:
            model = RecurrentPPO(
              "MlpLstmPolicy", env,
              n_steps=128, batch_size=5120, n_epochs=3, learning_rate=3e-4,  # batch 5120 x 3 epochs: about 2x faster than 2048 x 4 on CPU
              gamma=0.995, gae_lambda=0.95, clip_range=0.2, ent_coef=0.01, vf_coef=0.5, max_grad_norm=0.5,
              policy_kwargs=POLICY_KWARGS,
              tensorboard_log=str(run_dir / "tb"), device="cpu", verbose=1, seed=args.seed,
            )
            if args.init_policy:  # start from trained weights (e.g. a curriculum snapshot), fresh optimizer
                model.policy.load_state_dict(torch.load(args.init_policy, map_location="cpu"))
                print(f"[init] weights from {args.init_policy}", flush=True)
        resumed = {"resumed_from": json.loads((run_dir / "meta.json").read_text())} if args.resume else {}
        (run_dir / "meta.json").write_text(json.dumps({"args": {k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items()}, **resumed, "game_version": env.envs[0].hello["version"],
                                                        "obs_size": env.envs[0].obs_size, "action_nvec": [int(x) for x in env.action_space.nvec]}, indent=2))
        trainer = Trainer(args, run_dir, trainer_ports, eval_port, reward)
        trainer.started = time.time()
        trainer.current_stages = [STAGES[0][0] if args.curriculum else "self-play"] * args.servers
        if not args.curriculum and args.selfplay_bots and not args.resume:  # straight self-play: the bots server from the start
            k = args.servers - 2
            env.reconfigure_one(k, {"port": trainer_ports[k], "seed_base": 1_000_000 + 10_000_000 * k, "max_ticks": MAX_TICKS, "reward": reward,
                                    "n_envs": args.matches, "opponent": "bot", "options": {"opponent_skill": "random"}})
            trainer.current_stages[k] = "self-play bots"
        if args.resume:
            trainer.restore(model.num_timesteps)
        model.learn(total_timesteps=args.timesteps - model.num_timesteps, callback=trainer, tb_log_name="ppo",
                    reset_num_timesteps=not args.resume)
        model.save(run_dir / "final")
        trainer.evaluate()
        env.close()
        print("done:", run_dir / "final.zip")
    finally:
        servers.stop()


if __name__ == "__main__":
    main()

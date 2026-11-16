// Every tuning number of the game, in one place.
// Units are integers so every machine computes exactly the same thing:
//   distance: millimetres (mm)   time: ticks (60 per second)   speed: mm per tick

export const TICK_HZ = 60;
export const DECISION_TICKS = 4; // the AI decides 15 times a second; each decision lasts 4 ticks

export const LANES = 3;
export const LANE_WIDTH = 2400; // mm between lane centres
export const LANE_CHANGE_TICKS = 12; // 0.2 s
export const LANE_STEP = LANE_WIDTH / LANE_CHANGE_TICKS; // 200 mm per tick, exact

// Difficulty ("heat") rises for the whole run, with no ceiling (rules v4):
//   heat = LEVEL_BASE[start level] + a smooth ramp 0 -> 1 over RAMP_TICKS + STEP_HEAT every STEP_TICKS after that
// Speed, track density and the share of hard pieces all follow heat.
export const LEVEL_NAMES = ["easy", "normal", "hard"] as const;
export const LEVEL_BASE = [0, 0.3, 0.6]; // where each start level begins
export const RAMP_TICKS = 10800; // the smooth ramp reaches "hard" after 3 min
export const STEP_TICKS = 7200; // then a step up every 2 min...
export const STEP_HEAT = 0.25; // ...of this much, forever
export const START_SPEED = 170; // mm/tick ≈ 10 m/s at heat 0
export const SPEED_PER_HEAT = 140; // mm/tick per heat unit (heat 1 ≈ 18.6 m/s, heat 2 ≈ 27 m/s)
export const LEADIN_SQUEEZE = 0.4; // per heat unit: the empty run-up before each track piece shrinks...
export const LEADIN_SQUEEZE_MAX = 0.6; // ...to at most 60% shorter (the spacing inside a piece never changes)
export const EASY_FADE = 0.5; // per heat unit: easy pieces get rarer...
export const EASY_FADE_MAX = 0.85; // ...down to 15% of their weight
export const HARD_BOOST = 1.2; // per heat unit: a level-L piece is (1 + 1.2 L heat) times as likely

// Jump: ~0.76 s in the air, ~1.47 m high, with a short hang at the top (gravity halves near the apex)
export const GRAVITY = 8; // mm/tick²
export const HANG_V = 32; // below this vertical speed (up or down)...
export const HANG_GRAVITY = 4; // ...gravity is this (the hang)
export const JUMP_V = 150;
export const SPRING_JUMP_V = 220; // with spring shoes → about 3.1 m
export const FAST_DROP_V = -240; // roll in the air = drop fast
export const ROLL_TICKS = 36; // 0.6 s
export const ROLL_COOLDOWN = 12; // stand at least 0.2 s between rolls (no endless roll)

export const PLAYER_W = 800;
export const PLAYER_LEN = 600;
export const PLAYER_H = 1800;
export const PLAYER_ROLL_H = 800;
export const STEP_UP = 300; // how far below a roof the feet may be and still land on it

export const OBSTACLE_W = 2000; // obstacles fill most of a lane
export const LOW_BARRIER = { len: 400, y0: 0, y1: 1000 }; // jump over
export const HIGH_BARRIER = { len: 400, y0: 1000, y1: 3200 }; // roll under
export const TRAIN = { len: 20000, height: 3800 };
export const RAMP_LEN = 8000; // rises from the ground to the train roof
export const MOVING_TRAIN_SPEED = 120; // mm/tick toward the player
export const MOVING_TRAIN_WAKE = 60000; // starts moving when the player is this close

// Stumbles and the chaser ("lights-out": a blackout rolling down the street behind you).
// A side hit or a barrier hit is a stumble: you break through, slow down, and the chaser closes in.
// Stumble again while it is close and it catches you. Head-on into a train still ends the run.
export const STUMBLE_SLOW_TICKS = 60; // 1 s at 60% speed
export const STUMBLE_SLOW_PCT = 60;
export const CHASER_TICKS = 300; // the chaser stays close for 5 s after a stumble
export const CHASER_CLOSE = 3000; // mm behind the runner right after a stumble
export const CHASER_FAR = 40000; // where it drops back to when you run clean
export const CHASER_DROP = 60; // mm per tick it falls back
export const SHIELD_TICKS = 1800; // a shield lasts 30 s or until it absorbs one hit
export const SHIELD_GRACE = 45; // ticks of no collisions after the shield breaks

export const COIN_REACH = 700; // pickup box half-size
export const COIN_HEIGHT = 700; // above the surface
export const MAGNET_REACH = 30000; // magnet pulls coins this far ahead, any lane
export const POWER_TICKS = 600; // power-ups last 10 s

export const VIEW_DISTANCE = 96000; // how far ahead the track exists (and the AI may look)
export const RUNWAY = 40000; // empty start

export const SCORE_COIN = 5; // score = metres + 5 per coin (x2 with the double power-up)

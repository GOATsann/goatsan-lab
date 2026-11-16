// Every tuning number of the game, in one place.
// Units are integers so every machine computes exactly the same thing:
//   distance: millimetres (mm)   time: ticks (60 per second)   speed: mm per tick

export const TICK_HZ = 60;
export const DECISION_TICKS = 4; // the AI decides 15 times a second; each decision lasts 4 ticks

export const LANES = 3;
export const LANE_WIDTH = 2400; // mm between lane centres
export const LANE_CHANGE_TICKS = 12; // 0.2 s
export const LANE_STEP = LANE_WIDTH / LANE_CHANGE_TICKS; // 200 mm per tick, exact

export const START_SPEED = 170; // mm/tick ≈ 10 m/s
export const MAX_SPEED = 330; // mm/tick ≈ 20 m/s
export const SPEEDUP_EVERY = 300; // ticks between +1 mm/tick (5 s)

export const GRAVITY = 9; // mm/tick²
export const JUMP_V = 162; // → about 1.46 m high, 0.6 s in the air
export const SPRING_JUMP_V = 230; // with spring shoes → about 2.9 m
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

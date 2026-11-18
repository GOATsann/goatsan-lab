// BOT DIFFICULTY: every number that makes the AI levels easier or harder, in one place.
// Tune here. (Damage per hit, fire rate, clip and reload are in config.ts: BASE_DAMAGE, PART_MULT,
// FIRE_TICKS, CLIP, RELOAD_TICKS.) Changing these changes bot behaviour, so old replays of bot
// matches no longer match: bump VERSION in game.ts when you retune.
//
// Ticks are 1/60 s. Turn speeds are radians per tick (x 60 = radians per second).

export type SkillName = "easy" | "normal" | "hard";
export const SKILL_NAMES: SkillName[] = ["easy", "normal", "hard"];

export interface BotSkill {
  /** ticks from first seeing an enemy until it starts aiming at it */
  reactionTicks: number;
  /** max turn per tick (radians) */
  turnPerTick: number;
  /** steady aim wobble (radians, sd) */
  aimNoise: number;
  /** extra error on the first shots at a new target (radians, sd), fades out */
  firstShotNoise: number;
  /** aims at the head when the enemy is closer than this (metres) */
  headDist: number;
  /** fires when the aim error is under (part half-size x this) */
  fireTol: number;
  /** chance to strafe while fighting */
  strafeChance: number;
  /** chance to crouch-fire at range */
  crouchFire: number;
  /** seeks cover below this health */
  coverHealth: number;
  /** 0..1: how well it leads a moving target */
  lead: number;
}

export const SKILLS: Record<SkillName, BotSkill> = {
  easy: { reactionTicks: 30, turnPerTick: 2.6 / 60, aimNoise: 0.03, firstShotNoise: 0.09, headDist: 0, fireTol: 1.7, strafeChance: 0.3, crouchFire: 0, coverHealth: 30, lead: 0 },
  normal: { reactionTicks: 17, turnPerTick: 5 / 60, aimNoise: 0.014, firstShotNoise: 0.055, headDist: 9, fireTol: 1.25, strafeChance: 0.75, crouchFire: 0.2, coverHealth: 40, lead: 0.5 },
  hard: { reactionTicks: 10, turnPerTick: 8.5 / 60, aimNoise: 0.007, firstShotNoise: 0.03, headDist: 22, fireTol: 1.0, strafeChance: 1, crouchFire: 0.35, coverHealth: 45, lead: 1 },
};

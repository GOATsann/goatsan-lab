// The roster. Every character has the same health, speed and laser; the ONE difference is its ability.
import * as C from "./config";

export type AbilityKind = "dash" | "shield" | "scan" | "cloak";

export interface Character {
  id: number;
  name: string;
  ability: AbilityKind;
  abilityName: string;
  /** one line for the menu */
  blurb: string;
  cooldown: number; // ticks
  /** accent colour for the stand-in model (the robot's slot colour stays the main colour) */
  accent: string;
}

export const CHARACTERS: Character[] = [
  { id: 0, name: "Zip", ability: "dash", abilityName: "Dash", blurb: "A quick burst in the direction you're moving. Dodge, or slide into cover.", cooldown: C.DASH_COOLDOWN, accent: "#ffd23f" },
  { id: 1, name: "Brick", ability: "shield", abilityName: "Shield", blurb: "A frontal energy shield for 2 s that stops lasers. You can still shoot.", cooldown: C.SHIELD_COOLDOWN, accent: "#7fd1ff" },
  { id: 2, name: "Sonar", ability: "scan", abilityName: "Scan", blurb: "A pulse that shows your team every enemy within 20 m, through walls.", cooldown: C.SCAN_COOLDOWN, accent: "#9cff6e" },
  { id: 3, name: "Wisp", ability: "cloak", abilityName: "Cloak", blurb: "Nearly invisible for 3 s. Firing breaks it.", cooldown: C.CLOAK_COOLDOWN, accent: "#c49bff" },
];
export const N_CHARACTERS = CHARACTERS.length;

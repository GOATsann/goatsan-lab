// Put a trained policy into the game (public/models/), so Race the AI uses it.
//   npm run publish-model -- r3-v4            (runs/r3-v4/policy.onnx)
//   npm run publish-model -- r3-v4 5000000    (a checkpoint: runs/r3-v4/policy_5000000.onnx)
//   npm run publish-model -- r3-v4 5000000 --as easy   (the Easy opponent: public/models/policy-easy.*)
// Refuses a model made for other rules or another observation size.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { VERSION } from "../core/game";
import { OBS_SIZE } from "../core/obs";

const argv = process.argv.slice(2);
const asIdx = argv.indexOf("--as");
const as = asIdx >= 0 ? argv.splice(asIdx, 2)[1] : null;
if (as && !["easy", "normal", "hard"].includes(as)) throw new Error("--as must be easy, normal or hard");
const [run, steps] = argv;
const target = `public/models/policy${as ? `-${as}` : ""}`;
if (!run) throw new Error("usage: publish-model <run> [checkpoint steps]");
const stem = `runs/${run}/policy${steps ? `_${steps}` : ""}`;
for (const ext of [".onnx", ".json"]) if (!existsSync(stem + ext)) throw new Error(`missing ${stem}${ext}`);
const info = JSON.parse(readFileSync(stem + ".json", "utf8"));
if (info.version !== VERSION) throw new Error(`${stem} is for rules v${info.version}; the game is v${VERSION}`);
if (info.obs_size !== OBS_SIZE) throw new Error(`${stem} expects obs ${info.obs_size}; the game gives ${OBS_SIZE}`);
mkdirSync("public/models", { recursive: true });
copyFileSync(stem + ".onnx", target + ".onnx");
writeFileSync(target + ".json", JSON.stringify({ ...info, published: new Date().toISOString() }, null, 2) + "\n");
console.log(`published ${stem} (rules v${info.version}, ${info.steps ?? "?"} steps) -> ${target}.onnx`);

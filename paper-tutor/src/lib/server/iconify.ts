import "server-only";
import { cached } from "./cache";
import { getStore } from "./store";

// Pictures for any topic from Iconify (open-licensed icon sets). The tutor names what it wants ("bacteria",
// "cell membrane", "robot arm"); the server searches a few line-style sets, checks each set's licence, picks the
// best outline-style match, and keeps the SVG (cleaned) in the store, so the browser loads it from us.

// Line or outline sets, most consistent first. Each one's licence is checked against ALLOWED before use.
const SETS = ["lucide", "tabler", "healthicons", "ph", "solar", "mdi", "material-symbols", "carbon"];
const ALLOWED = new Set(["MIT", "ISC", "Apache-2.0", "CC0-1.0"]);
const API = "https://api.iconify.design";

type Collection = { license?: { spdx?: string }; palette?: boolean };

async function allowedSets(): Promise<string[]> {
  return cached("iconify:collections", 7 * 24 * 3600_000, async () => {
    const res = await fetch(`${API}/collections?prefixes=${SETS.join(",")}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Iconify answered ${res.status}`);
    const d = (await res.json()) as Record<string, Collection>;
    return SETS.filter((p) => d[p] && !d[p].palette && ALLOWED.has(d[p].license?.spdx ?? ""));
  });
}

const STYLE_PENALTY = /(bold|fill|filled|solid|duotone|sharp|twotone|-thin)/;
function score(id: string, sets: string[]): number {
  const [prefix, name] = id.split(":");
  let s = sets.indexOf(prefix) * 10;
  if (STYLE_PENALTY.test(name)) s += 25;
  if (/outline|linear|line\b|-line/.test(name)) s -= 4;
  return s;
}

export const ICON_ID = /^[a-z0-9-]+:[a-z0-9-]+$/;

// "bacteria" -> "healthicons:bacteria-outline" (or null when nothing fits).
export async function findIcon(query: string): Promise<string | null> {
  const q = query.toLowerCase().replace(/[^a-z0-9 -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!q) return null;
  return cached(`iconify:search:${q}`, 30 * 24 * 3600_000, async () => {
    const sets = await allowedSets();
    const res = await fetch(`${API}/search?query=${encodeURIComponent(q)}&prefixes=${sets.join(",")}&limit=48`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { icons?: string[] };
    const icons = (d.icons ?? []).filter((id) => ICON_ID.test(id) && sets.includes(id.split(":")[0]));
    if (!icons.length) return null;
    icons.sort((a, b) => score(a, sets) - score(b, sets));
    const best = icons[0];
    await iconSvg(best); // fetch and keep it now, so the board never waits for it
    return best;
  });
}

// The cleaned SVG of an icon (only shapes; drawn in the theme's ink by the browser).
export async function iconSvg(id: string): Promise<string | null> {
  if (!ICON_ID.test(id)) return null;
  const [prefix, name] = id.split(":");
  if (!(await allowedSets()).includes(prefix)) return null;
  const key = `icons/${prefix}/${name}.svg`;
  const store = getStore();
  const hit = await store.getBlob(key);
  if (hit) return hit.toString("utf8");
  const res = await fetch(`${API}/${prefix}/${name}.svg?height=none`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const raw = await res.text();
  if (raw.length > 40_000 || !raw.startsWith("<svg") || /<script|on[a-z]+=|href=|xlink|<foreignObject|<style|url\(/i.test(raw)) return null;
  await store.putBlob(key, Buffer.from(raw, "utf8"));
  return raw;
}

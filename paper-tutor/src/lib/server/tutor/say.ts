import "server-only";
import type { Pronunciation } from "@/lib/types";

// Spoken lines are written for the ear: the board keeps "GR00T", the voice says "Groot". The list of a paper's
// tricky names comes from the quick map (an LLM pass); every "say" line is rewritten with it, plus general rules
// for zeros used as O in names and version numbers after names.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Rewrite a spoken line for the ear.
export function speakable(say: string, list: Pronunciation[]): string {
  let out = say;
  for (const p of [...list].sort((a, b) => b.written.length - a.written.length)) {
    out = out.replace(new RegExp(`(?<![\\w-])${escape(p.written)}(?![\\w])`, "g"), p.spoken);
  }
  // A zero used as the letter O inside a name ("GR00T", "R0B0T"): read it as O, and say an all-caps name as a word.
  out = out.replace(/\b[A-Za-z]+(?:0+[A-Za-z]+)+\b/g, (w) => {
    const word = w.replace(/0/g, "o");
    const letters = w.replace(/0/g, "");
    return letters === letters.toUpperCase() ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;
  });
  // A version number after a name ("Groot 2", "Llama 3") reads more reliably as a word.
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  out = out.replace(/\b([A-Z][A-Za-z]+) (\d)(?![\d.,%])\b/g, (_m, name: string, d: string) => `${name} ${words[Number(d)]}`);
  return out;
}

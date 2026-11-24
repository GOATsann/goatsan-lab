import "server-only";
import { getStore } from "./store";

// A monthly cap on what the AI and the voice may cost, for the whole app. Every model and voice call adds its cost
// here (an atomic add in the store); once the month's total reaches the cap, new generation stops with a clear
// message. Anything already made (saved overviews, deep dives, voice) still plays, and nothing is ever cut mid-way.
export const SPEND_CAP_USD = Number(process.env.SPEND_CAP_USD || 50);

export class BudgetError extends Error {
  status = 503;
}

const monthKey = () => `spend/${new Date().toISOString().slice(0, 7)}.json`;
const FORTY_DAYS = 40 * 86400;

// $ per million tokens: input, output, cache read, cache write (5-minute).
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};
// Fallbacks or unknown models are priced like Opus, so the cap errs on the safe side.
const price = (model: string) => PRICES[model] ?? PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? "claude-opus-5-5"];

export type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

export function anthropicCost(model: string, u: Usage) {
  const [i, o, r, w] = price(model);
  return ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o + (u.cache_read_input_tokens ?? 0) * r + (u.cache_creation_input_tokens ?? 0) * w) / 1e6;
}

// gpt-4o-mini-tts: about $0.015 per minute of audio; about 900 characters a minute.
export const ttsCost = (chars: number) => (chars / 900) * 0.015;

export async function spentThisMonth() {
  return (await getStore().getJSON<{ total?: number }>(monthKey()))?.total ?? 0;
}

export async function assertBudget() {
  if ((await spentThisMonth()) >= SPEND_CAP_USD) {
    throw new BudgetError(
      "Paper Tutor has used this month's AI budget, so new overviews, deep dives and answers are paused until the 1st. Overviews already made still play.",
    );
  }
}

export async function recordSpend(usd: number) {
  if (!(usd > 0)) return;
  try {
    await getStore().add(monthKey(), usd, { ttlSec: FORTY_DAYS });
  } catch (e) {
    console.error("[spend]", e);
  }
}

export function recordAnthropic(model: string, u: Usage) {
  return recordSpend(anthropicCost(model, u));
}

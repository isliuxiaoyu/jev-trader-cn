import { DecisionError } from "./types";

/** Normalize a candidate distribution onto `options`. Non-finite and negative masses are dropped. */
export function normalizeProbabilities(raw: Record<string, number>, options: readonly string[]): Record<string, number> {
  const cleaned: Record<string, number> = {};
  let sum = 0;
  for (const opt of options) {
    const v = raw[opt];
    const n = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
    cleaned[opt] = n;
    sum += n;
  }
  if (sum <= 0) {
    throw new DecisionError("probability distribution has no positive mass on the schema options");
  }
  const out: Record<string, number> = {};
  for (const opt of options) out[opt] = cleaned[opt]! / sum;
  return out;
}

export interface TopStats {
  selected: string;
  topProbability: number;
  margin: number;
}

/** `margin` is the gap between the best option and the second. Ties keep schema order. */
export function topAndMargin(probabilities: Record<string, number>, options: readonly string[]): TopStats {
  if (options.length === 0) throw new DecisionError("choice question has no options");
  let selected = options[0]!;
  let top = probabilities[selected] ?? 0;
  let second = 0;
  for (const opt of options) {
    const p = probabilities[opt] ?? 0;
    if (p > top) {
      second = top;
      selected = opt;
      top = p;
    } else if (opt !== selected && p > second) {
      second = p;
    }
  }
  return { selected, topProbability: top, margin: top - second };
}

export function pointMass(selected: string, options: readonly string[]): Record<string, number> {
  if (!options.includes(selected)) {
    throw new DecisionError(`point estimate ${selected} is not in [${options.join(", ")}]`);
  }
  const out: Record<string, number> = {};
  for (const opt of options) out[opt] = opt === selected ? 1 : 0;
  return out;
}

/** Map AgentJev / Nimble boolean keys onto YES / NO. */
export function booleanMasses(raw: Record<string, number> | undefined, pTrue: number | undefined): { YES: number; NO: number } {
  const yes = raw?.YES ?? raw?.yes ?? raw?.true ?? raw?.True;
  const no = raw?.NO ?? raw?.no ?? raw?.false ?? raw?.False;
  if (typeof yes === "number" || typeof no === "number") {
    const y = typeof yes === "number" && Number.isFinite(yes) ? Math.max(0, yes) : 0;
    const n = typeof no === "number" && Number.isFinite(no) ? Math.max(0, no) : 0;
    if (y + n <= 0) throw new DecisionError("boolean distribution is empty");
    return { YES: y / (y + n), NO: n / (y + n) };
  }
  if (typeof pTrue === "number" && Number.isFinite(pTrue)) {
    const y = Math.min(1, Math.max(0, pTrue));
    return { YES: y, NO: 1 - y };
  }
  throw new DecisionError("boolean answer has neither a distribution nor P(true)");
}

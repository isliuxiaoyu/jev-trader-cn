import type { RawQuote } from "../market/types";
import type { PredictionRecord } from "./log";

export interface ModelMetrics {
  model: string;
  modelVersion: string;
  questionId: string;
  symbol: string;
  schema: string;
  horizonMs: number;
  count: number;
  labeled: number;
  top1Accuracy: number | null;
  logLoss: number | null;
  brier: number | null;
  ece: number | null;
  calibration: Array<{ bin: number; confidence: number; accuracy: number; count: number }>;
  avgFutureReturn: number | null;
  medianFutureReturn: number | null;
  avgMfe: number | null;
  avgMae: number | null;
  avgLatencyMs: number | null;
  throughputPerSec: number | null;
  memoryBytes: number | null;
}

export interface EvaluationReport {
  experimentId: string;
  horizonMs: number;
  byModel: ModelMetrics[];
}

/** Label records from prices strictly after the decision timestamp. */
export function labelOutcomes(records: PredictionRecord[], quotes: RawQuote[], horizonMs: number, flatBand: number): PredictionRecord[] {
  return records.map((rec) => {
    const path = quotes.filter((q) => q.symbol === rec.symbol && q.timestamp > rec.timestamp && q.timestamp <= rec.timestamp + horizonMs);
    if (path.length === 0) return { ...rec };
    const entry = num(rec.stateSnapshot.price);
    const last = path[path.length - 1]!;
    if (!(entry > 0)) return { ...rec };
    const futureReturn = last.price / entry - 1;
    const rets = path.map((q) => q.price / entry - 1);
    const pathMax = Math.max(...rets);
    const pathMin = Math.min(...rets);
    let mfe = pathMax;
    let mae = pathMin;
    if (rec.finalAction === "SELL") {
      mfe = -pathMin;
      mae = -pathMax;
    }
    return {
      ...rec,
      futurePrice: last.price,
      futureReturn,
      mfe,
      mae,
      outcome: outcomeLabel(rec.options, futureReturn, flatBand) ?? undefined,
    };
  });
}

export function evaluatePredictions(records: PredictionRecord[], experimentId: string, horizonMs: number, memoryBytes: number | null = null): EvaluationReport {
  const groups = new Map<string, PredictionRecord[]>();
  for (const rec of records) {
    const key = `${rec.model}\0${rec.question}`;
    const list = groups.get(key) ?? [];
    list.push(rec);
    groups.set(key, list);
  }
  const byModel: ModelMetrics[] = [];
  for (const rows of groups.values()) {
    const head = rows[0]!;
    const labeled = rows.filter((r) => r.outcome && r.outcome in r.probabilities);
    const returns = rows.map((r) => r.futureReturn).filter((n): n is number => typeof n === "number");
    const mfes = rows.map((r) => r.mfe).filter((n): n is number => typeof n === "number");
    const maes = rows.map((r) => r.mae).filter((n): n is number => typeof n === "number");
    const lat = rows.map((r) => r.latencyMs).filter((n) => Number.isFinite(n));
    const latSum = lat.reduce((s, n) => s + n, 0);
    byModel.push({
      model: head.model,
      modelVersion: head.modelVersion,
      questionId: head.questionId,
      symbol: head.symbol,
      schema: head.schema,
      horizonMs,
      count: rows.length,
      labeled: labeled.length,
      top1Accuracy: labeled.length ? labeled.filter((r) => r.selectedValue === r.outcome).length / labeled.length : null,
      logLoss: mean(labeled.map((r) => -Math.log(Math.min(1, Math.max(1e-15, r.probabilities[r.outcome!] ?? 1e-15))))),
      brier: mean(labeled.map((r) => brier(r.probabilities, r.outcome!))),
      ece: ece(labeled).score,
      calibration: ece(labeled).bins,
      avgFutureReturn: mean(returns),
      medianFutureReturn: returns.length ? median(returns) : null,
      avgMfe: mean(mfes),
      avgMae: mean(maes),
      avgLatencyMs: mean(lat),
      throughputPerSec: latSum > 0 ? rows.length / (latSum / 1000) : null,
      memoryBytes,
    });
  }
  return { experimentId, horizonMs, byModel };
}

function outcomeLabel(options: string[], futureReturn: number, flatBand: number): string | null {
  const set = new Set(options);
  if (set.has("STRONG_UP") || set.has("STRONG_DOWN")) {
    if (futureReturn > 0.003) return "STRONG_UP";
    if (futureReturn > flatBand) return "UP";
    if (futureReturn < -0.003) return "STRONG_DOWN";
    if (futureReturn < -flatBand) return "DOWN";
    return set.has("FLAT") ? "FLAT" : null;
  }
  if (set.has("UP") && set.has("DOWN")) {
    if (futureReturn > flatBand) return "UP";
    if (futureReturn < -flatBand) return "DOWN";
    return set.has("FLAT") ? "FLAT" : null;
  }
  if (set.has("BUY") && set.has("SELL")) {
    if (futureReturn > flatBand) return "BUY";
    if (futureReturn < -flatBand) return "SELL";
    return set.has("HOLD") ? "HOLD" : null;
  }
  return null;
}

function brier(probabilities: Record<string, number>, outcome: string): number {
  let score = 0;
  for (const [key, p] of Object.entries(probabilities)) score += (p - (key === outcome ? 1 : 0)) ** 2;
  return score;
}

function ece(rows: PredictionRecord[]): { score: number | null; bins: ModelMetrics["calibration"] } {
  if (rows.length === 0) return { score: null, bins: [] };
  const bins: ModelMetrics["calibration"] = [];
  let accSum = 0;
  let weight = 0;
  for (let i = 0; i < 10; i++) {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    const group = rows.filter((r) => r.topProbability >= lo && (i === 9 ? r.topProbability <= hi : r.topProbability < hi));
    if (group.length === 0) continue;
    const confidence = group.reduce((s, r) => s + r.topProbability, 0) / group.length;
    const accuracy = group.filter((r) => r.selectedValue === r.outcome).length / group.length;
    bins.push({ bin: i, confidence, accuracy, count: group.length });
    accSum += group.length * Math.abs(accuracy - confidence);
    weight += group.length;
  }
  return { score: weight ? accSum / weight : null, bins };
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, n) => s + n, 0) / xs.length;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function num(value: number | string | boolean | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

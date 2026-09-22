import type { TradeAction } from "../decision/policy";

export interface PredictionRecord {
  predictionId: string;
  timestamp: number;
  symbol: string;
  model: string;
  modelVersion: string;
  schema: string;
  stateSnapshot: Record<string, number | string | boolean | null>;
  questionId: string;
  question: string;
  options: string[];
  probabilities: Record<string, number>;
  selectedValue: string;
  topProbability: number;
  margin: number;
  latencyMs: number;
  decisionPolicy: string | null;
  finalAction: TradeAction | null;
  futurePrice?: number;
  futureReturn?: number;
  mfe?: number;
  mae?: number;
  outcome?: string;
}

export class PredictionLog {
  private readonly rows: PredictionRecord[] = [];

  add(row: PredictionRecord): void {
    this.rows.push(row);
  }

  all(): PredictionRecord[] {
    return this.rows.map((row) => ({ ...row, probabilities: { ...row.probabilities }, stateSnapshot: { ...row.stateSnapshot } }));
  }

  replace(rows: PredictionRecord[]): void {
    this.rows.length = 0;
    this.rows.push(...rows);
  }
}

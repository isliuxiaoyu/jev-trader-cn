export type TradeAction = "BUY" | "HOLD" | "SELL";

export interface AnswerView {
  questionId: string;
  type: string;
  probabilities: Record<string, number>;
  selectedValue: string;
  topProbability: number;
  margin: number;
}

export interface ComparisonView {
  model: string;
  modelVersion: string;
  probabilities: Record<string, number>;
  selectedValue: string;
  topProbability: number;
  margin: number;
}

export interface Tick {
  ts: number;
  symbol: string;
  price: number;
  spreadBps: number;
  bookImbalance: number;
  model: string;
  modelVersion: string;
  schemaId: string;
  questionId: string;
  question: string;
  options: string[];
  probabilities: Record<string, number>;
  selectedValue: string;
  topProbability: number;
  margin: number;
  latencyMs: number;
  action: TradeAction;
  policyId: string;
  guardOk: boolean;
  guardReasons: string[];
  stateSummary: Record<string, number | string | boolean | null>;
  answers: AnswerView[];
  comparisons: ComparisonView[];
  order: { id: string; side: string; qty: number; price: number; status: string; filledQty: number; reason?: string } | null;
  fill: { qty: number; price: number; fee: number } | null;
  position: { qty: number; available: number; avgCost: number | null };
  pnl: { realized: number; unrealized: number; fees: number; total: number; cash: number };
}

export interface ModelMetrics {
  model: string;
  modelVersion: string;
  questionId: string;
  count: number;
  labeled: number;
  top1Accuracy: number | null;
  logLoss: number | null;
  brier: number | null;
  ece: number | null;
  avgFutureReturn: number | null;
  medianFutureReturn: number | null;
  avgMfe: number | null;
  avgMae: number | null;
  avgLatencyMs: number | null;
}

export interface Experiment {
  id: string;
  dataset: string;
  marketDataProvider: string;
  featureVersion: string;
  model: string;
  modelVersion: string;
  schema: string;
  policy: string;
  tradingRuleProfile: string;
  executionModel: string;
}

export interface Meta {
  model: string;
  modelVersion: string;
  schema: string;
  policy: string;
  symbol: string;
  mode: string;
  startedAt: number;
  experiment: Experiment | null;
  evaluation: { byModel: ModelMetrics[] } | null;
}

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface FeedState {
  meta: Meta | null;
  events: Tick[];
  latest: Tick | null;
  connection: ConnectionState;
}

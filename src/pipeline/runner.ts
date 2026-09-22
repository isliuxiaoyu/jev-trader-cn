import type { ExecutionModel } from "../broker/types";
import { PaperTrader } from "../broker/paper";
import { assertCanRun } from "../decision/capabilities";
import type { DecisionModel, DecisionSchema } from "../decision/types";
import type { DecisionPolicy, TradeAction } from "../decision/policy";
import { labelOutcomes, evaluatePredictions, type EvaluationReport } from "../eval/metrics";
import { PredictionLog, type PredictionRecord } from "../eval/log";
import { assertNoLookahead, toNormalizedState, type AStockFeatureEngine } from "../market/features";
import { inContinuousSession } from "../market/clock";
import type { AStockTradeState, MarketDataProvider, RawQuote } from "../market/types";
import type { AStockTradingRules } from "../rules/astock";

export type RunMode = "replay" | "backtest" | "paper";

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

export interface TickRecord {
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
  answers: Array<{ questionId: string; type: string; probabilities: Record<string, number>; selectedValue: string; topProbability: number; margin: number }>;
  comparisons: Array<{ model: string; modelVersion: string; probabilities: Record<string, number>; selectedValue: string; topProbability: number; margin: number }>;
  order: { id: string; side: string; qty: number; price: number; status: string; filledQty: number; reason?: string } | null;
  fill: { qty: number; price: number; fee: number } | null;
  position: { qty: number; available: number; avgCost: number | null };
  pnl: { realized: number; unrealized: number; fees: number; total: number; cash: number };
}

export interface Pipeline {
  mode: RunMode;
  experiment: Experiment;
  provider: MarketDataProvider;
  features: AStockFeatureEngine;
  models: DecisionModel[];
  primaryModelId: string;
  schema: DecisionSchema;
  policy: DecisionPolicy;
  rules: AStockTradingRules;
  broker: PaperTrader;
  execution: ExecutionModel;
  log: PredictionLog;
  symbol: string;
  horizonMs: number;
  flatBand: number;
}

export interface RunResult {
  experiment: Experiment;
  ticks: TickRecord[];
  predictions: PredictionRecord[];
  evaluation: EvaluationReport;
}

export async function runStep(pipeline: Pipeline, asOf: number): Promise<TickRecord> {
  const quotes = pipeline.provider.history(pipeline.symbol, asOf);
  assertNoLookahead(quotes.map((q) => q.timestamp), asOf);
  const account = pipeline.broker.snapshot(pipeline.symbol);
  const state = pipeline.features.build({
    symbol: pipeline.symbol,
    asOf,
    quotes,
    account: {
      position: account.position,
      availablePosition: account.availablePosition,
      availableCash: account.availableCash,
      averageCost: account.averageCost,
    },
    profile: pipeline.rules.profile,
  });
  const request = { state: toNormalizedState(state), schema: pipeline.schema, asOf };
  const responses = [];
  for (const model of pipeline.models) {
    assertCanRun(model, pipeline.schema);
    responses.push(await model.decide(request));
  }
  const primary = responses.find((r) => r.model === pipeline.primaryModelId);
  if (!primary) throw new Error(`primary model ${pipeline.primaryModelId} did not answer`);
  const decision = pipeline.policy.interpret({ response: primary, peers: responses.filter((r) => r !== primary), state, schema: pipeline.schema });
  const execute = pipeline.mode === "backtest" || pipeline.mode === "paper";
  const qty = pipeline.rules.profile.defaultQty;
  const guard = decision.action === "HOLD" || !execute
    ? { ok: decision.action === "HOLD", reasons: decision.action === "HOLD" ? ["hold"] : ["replay does not send orders"] }
    : pipeline.rules.check({ symbol: pipeline.symbol, side: decision.action, qty, timestamp: asOf }, state, account);
  let order: TickRecord["order"] = null;
  let fill: TickRecord["fill"] = null;
  if (execute && decision.action !== "HOLD") {
    for (const open of pipeline.broker.getOrders()) {
      if (open.symbol === pipeline.symbol && (open.status === "open" || open.status === "partial")) pipeline.broker.cancelOrder(open.id);
    }
    const placed = pipeline.broker.placeOrder({
      symbol: pipeline.symbol,
      side: decision.action,
      qty,
      timestamp: asOf,
      state,
      type: "market",
    });
    order = { id: placed.id, side: placed.side, qty: placed.qty, price: placed.avgFillPrice, status: placed.status, filledQty: placed.filledQty, reason: placed.reason };
    if (placed.filledQty > 0) fill = { qty: placed.filledQty, price: placed.avgFillPrice, fee: placed.fee };
  } else {
    pipeline.broker.onMarketUpdate(state);
  }
  const finalAction: TradeAction = !execute ? decision.action : guard.ok ? decision.action : "HOLD";
  const memory = typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed : null;
  for (const response of responses) {
    const isPrimary = response.model === pipeline.primaryModelId;
    for (const answer of response.answers) {
      const question = pipeline.schema.questions.find((q) => q.id === answer.questionId);
      pipeline.log.add({
        predictionId: `${response.model}:${answer.questionId}:${asOf}`,
        timestamp: asOf,
        symbol: pipeline.symbol,
        model: response.model,
        modelVersion: response.modelVersion,
        schema: pipeline.schema.id,
        stateSnapshot: request.state.features,
        questionId: answer.questionId,
        question: question?.prompt ?? answer.questionId,
        options: answer.type === "score" ? answer.levels : answer.options,
        probabilities: { ...answer.probabilities },
        selectedValue: answer.selectedValue,
        topProbability: answer.topProbability,
        margin: answer.margin,
        latencyMs: response.latencyMs,
        decisionPolicy: isPrimary ? pipeline.policy.id : null,
        finalAction: isPrimary ? finalAction : null,
        ...(memory != null ? {} : {}),
      });
    }
    if (memory != null) response.metadata.memoryBytes = memory;
  }
  const focus = primary.answers.find((a) => a.questionId.startsWith("direction") || a.questionId === "trade_action") ?? primary.answers[0];
  if (!focus) throw new Error("model returned no answers");
  const acct = pipeline.broker.getAccount();
  const pos = pipeline.broker.getPositions().find((p) => p.symbol === pipeline.symbol);
  return {
    ts: asOf,
    symbol: pipeline.symbol,
    price: state.price,
    spreadBps: state.spreadBps,
    bookImbalance: state.bookImbalance,
    model: primary.model,
    modelVersion: primary.modelVersion,
    schemaId: pipeline.schema.id,
    questionId: focus.questionId,
    question: pipeline.schema.questions.find((q) => q.id === focus.questionId)?.prompt ?? focus.questionId,
    options: focus.type === "score" ? focus.levels : focus.options,
    probabilities: { ...focus.probabilities },
    selectedValue: focus.selectedValue,
    topProbability: focus.topProbability,
    margin: focus.margin,
    latencyMs: primary.latencyMs,
    action: finalAction,
    policyId: decision.policyId,
    guardOk: decision.action === "HOLD" ? true : guard.ok,
    guardReasons: guard.reasons,
    stateSummary: request.state.features,
    answers: primary.answers.map((a) => ({
      questionId: a.questionId,
      type: a.type,
      probabilities: { ...a.probabilities },
      selectedValue: a.selectedValue,
      topProbability: a.topProbability,
      margin: a.margin,
    })),
    comparisons: responses.map((r) => {
      const a = r.answers.find((x) => x.questionId === focus.questionId) ?? r.answers[0];
      return {
        model: r.model,
        modelVersion: r.modelVersion,
        probabilities: a ? { ...a.probabilities } : {},
        selectedValue: a?.selectedValue ?? "",
        topProbability: a?.topProbability ?? 0,
        margin: a?.margin ?? 0,
      };
    }),
    order,
    fill,
    position: { qty: pos?.qty ?? 0, available: pos?.available ?? 0, avgCost: pos?.averageCost ?? null },
    pnl: { realized: acct.realized, unrealized: acct.unrealized, fees: acct.fees, total: acct.realized + acct.unrealized, cash: acct.cash },
  };
}

export function finalize(pipeline: Pipeline, ticks: TickRecord[]): RunResult {
  const full = pipeline.provider.history(pipeline.symbol, Number.POSITIVE_INFINITY);
  const labeled = labelOutcomes(pipeline.log.all(), full, pipeline.horizonMs, pipeline.flatBand);
  pipeline.log.replace(labeled);
  const memory = typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed : null;
  return {
    experiment: { ...pipeline.experiment, modelVersion: pipeline.models.find((m) => m.id === pipeline.primaryModelId)?.version ?? pipeline.experiment.modelVersion },
    ticks,
    predictions: pipeline.log.all(),
    evaluation: evaluatePredictions(labeled, pipeline.experiment.id, pipeline.horizonMs, memory),
  };
}

export async function runSeries(pipeline: Pipeline, times: number[]): Promise<RunResult> {
  const ticks: TickRecord[] = [];
  for (const ts of times) ticks.push(await runStep(pipeline, ts));
  return finalize(pipeline, ticks);
}

export function decisionTimes(quotes: RawQuote[], symbol: string, intervalMs: number): number[] {
  const rows = quotes.filter((q) => q.symbol === symbol).slice().sort((a, b) => a.timestamp - b.timestamp);
  const times: number[] = [];
  let next = rows[0]?.timestamp ?? 0;
  for (const row of rows) {
    if (row.timestamp < next) continue;
    if (!inContinuousSession(row.timestamp)) continue;
    times.push(row.timestamp);
    next = row.timestamp + intervalMs;
  }
  return times;
}

export function buildStateOnly(pipeline: Pick<Pipeline, "provider" | "features" | "rules" | "broker" | "symbol">, asOf: number): AStockTradeState {
  const quotes = pipeline.provider.history(pipeline.symbol, asOf);
  assertNoLookahead(quotes.map((q) => q.timestamp), asOf);
  const account = pipeline.broker.snapshot(pipeline.symbol);
  return pipeline.features.build({
    symbol: pipeline.symbol,
    asOf,
    quotes,
    account,
    profile: pipeline.rules.profile,
  });
}

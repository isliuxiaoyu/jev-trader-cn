import { expect, test } from "bun:test";
import { BestAskPlusSlippage } from "../broker/types";
import { PaperTrader } from "../broker/paper";
import { loadConfig } from "../config";
import { createModel } from "../decision/registry";
import type { RawInference } from "../decision/types";
import { createPolicy } from "../decision/policy";
import { getSchema } from "../decision/schema";
import { AStockFeatureEngine } from "../market/features";
import { MockMarketDataProvider } from "../market/providers";
import { shanghaiTs } from "../market/clock";
import type { RawQuote } from "../market/types";
import { registerBuiltinModels } from "../models/register";
import { AStockTradingRules } from "../rules/astock";
import { PredictionLog } from "../eval/log";
import { decisionTimes, runSeries, type Pipeline } from "./runner";

test("temperature is not invented for typed decision models", () => {
  registerBuiltinModels();
  const cfg = loadConfig({ MODEL: "agent-jev", MODEL_TEMPERATURE: "0.7", MODEL_ENDPOINT: "http://127.0.0.1:9" });
  expect(cfg.ignoredParams).toContain("temperature");
  expect(cfg.model.temperature).toBeUndefined();
  expect(cfg.model.endpoint).toBe("http://127.0.0.1:9");
});

test("the same tape and schema compare models without ranking a winner", async () => {
  registerBuiltinModels();
  const quotes = risingTape();
  const times = decisionTimes(quotes, "600000.SH", 60_000);
  const backend = {
    async infer(): Promise<RawInference> {
      return {
        answers: [
          { id: "direction_5m", distribution: { UP: 0.81, FLAT: 0.12, DOWN: 0.07 } },
          { id: "tradeability", distribution: { YES: 0.9, NO: 0.1 } },
        ],
      };
    },
  };
  const ids = ["baseline-momentum", "agent-jev", "nimble-9b"] as const;
  const runs = [];
  for (const id of ids) {
    const pipeline = makePipeline(quotes, id === "baseline-momentum" ? "backtest" : "replay", [createModel(id, {}, id === "baseline-momentum" ? undefined : { backend })]);
    runs.push(await runSeries(pipeline, times));
  }
  const stamps = runs.map((run) => run.predictions.filter((p) => p.question.includes("5 分钟")).map((p) => p.timestamp).join(","));
  expect(stamps[0]).toBe(stamps[1]);
  expect(stamps[1]).toBe(stamps[2]);
  expect(new Set(runs.flatMap((run) => run.predictions.map((p) => p.model))).size).toBe(3);
  for (const run of runs) {
    expect(run.predictions.every((p) => p.modelVersion.length > 0)).toBe(true);
    expect(run.predictions.every((p) => p.schema === "direction_5m_v1")).toBe(true);
    expect(JSON.stringify(run.evaluation)).not.toContain("bestModel");
    expect(run.evaluation.byModel.length).toBeGreaterThan(0);
  }
  const backtest = runs[0]!;
  expect(backtest.ticks.some((t) => t.order && t.order.status !== "rejected")).toBe(true);
  const replay = runs[1]!;
  expect(replay.ticks.every((t) => t.order == null)).toBe(true);
  const future = quotes[quotes.length - 1]!.price;
  expect(backtest.predictions.some((p) => p.stateSnapshot.price === future && p.timestamp < quotes[quotes.length - 1]!.timestamp)).toBe(false);
});

function makePipeline(quotes: RawQuote[], mode: Pipeline["mode"], models: Pipeline["models"]): Pipeline {
  const rules = AStockTradingRules.fromId("AStock-MainBoard-v1");
  const execution = new BestAskPlusSlippage(rules.profile.slippageBps);
  const primary = models[0]!;
  return {
    mode,
    experiment: {
      id: "2026-A-001",
      dataset: "unit",
      marketDataProvider: "mock",
      featureVersion: "v1",
      model: primary.id,
      modelVersion: primary.version,
      schema: "direction_5m_v1",
      policy: "threshold-v1",
      tradingRuleProfile: rules.profile.id,
      executionModel: execution.id,
    },
    provider: new MockMarketDataProvider(quotes),
    features: new AStockFeatureEngine(),
    models,
    primaryModelId: primary.id,
    schema: getSchema("direction_5m_v1"),
    policy: createPolicy("threshold-v1"),
    rules,
    broker: new PaperTrader(rules, execution, 200_000),
    execution,
    log: new PredictionLog(),
    symbol: "600000.SH",
    horizonMs: 300_000,
    flatBand: rules.profile.flatBand,
  };
}

function risingTape(): RawQuote[] {
  const start = shanghaiTs(2026, 9, 22, 10, 0, 0);
  const quotes: RawQuote[] = [];
  for (let i = 0; i < 40; i++) {
    const price = Math.round((10 + i * 0.03) * 100) / 100;
    const timestamp = start + i * 10_000;
    quotes.push({
      symbol: "600000.SH",
      timestamp,
      price,
      open: 10,
      high: price,
      low: 10,
      prevClose: 10,
      volume: 1000 + i * 100,
      amount: price * (1000 + i * 100),
      bids: [price - 0.01, 0, 0, 0, 0],
      asks: [price + 0.01, 0, 0, 0, 0],
      bidVolumes: [400, 0, 0, 0, 0],
      askVolumes: [500, 0, 0, 0, 0],
      trades: [{ timestamp, price, volume: 100, side: "buy" }],
      indexPrice: 100 + i * 0.001,
      sectorPrice: 50,
    });
  }
  return quotes;
}

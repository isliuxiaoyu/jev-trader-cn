import { readFileSync } from "node:fs";
import { createExecution } from "../broker/types";
import { PaperTrader } from "../broker/paper";
import { loadConfig, type AppConfig } from "../config";
import { createModel } from "../decision/registry";
import { createPolicy } from "../decision/policy";
import { getSchema } from "../decision/schema";
import type { DecisionModel, ModelRuntimeConfig } from "../decision/types";
import { PredictionLog } from "../eval/log";
import { AStockFeatureEngine, FEATURE_VERSION } from "../market/features";
import { CsvMarketDataProvider, IFindMarketDataProvider, MockMarketDataProvider } from "../market/providers";
import { buildSampleTape } from "../market/tape";
import type { MarketDataProvider, RawQuote } from "../market/types";
import { registerBuiltinModels } from "../models/register";
import { AStockTradingRules } from "../rules/astock";
import { decisionTimes, finalize, runSeries, runStep, type Pipeline, type RunResult, type TickRecord } from "../pipeline/runner";

export interface Runtime {
  config: AppConfig;
  pipeline: Pipeline;
  quotes: RawQuote[];
  times: number[];
  runBatch(): Promise<RunResult>;
  runPaper(onTick: (tick: TickRecord) => void): Promise<RunResult>;
}

export function buildRuntime(config: AppConfig = loadConfig()): Runtime {
  registerBuiltinModels();
  const { provider, quotes } = makeProvider(config);
  const rules = AStockTradingRules.fromId(config.rulesId);
  const execution = createExecution(config.executionId, rules.profile.slippageBps);
  const broker = new PaperTrader(rules, execution, config.cash);
  const models = unique([config.modelId, ...config.compareModelIds]).map((id) => createModel(id, configFor(id, config)));
  const primary = models.find((m) => m.id === config.modelId);
  if (!primary) throw new Error(`missing primary model ${config.modelId}`);
  const schema = getSchema(config.schemaId);
  const pipeline: Pipeline = {
    mode: config.mode,
    experiment: {
      id: config.experimentId,
      dataset: config.dataset,
      marketDataProvider: provider.id,
      featureVersion: FEATURE_VERSION,
      model: primary.id,
      modelVersion: primary.version,
      schema: schema.id,
      policy: config.policyId,
      tradingRuleProfile: rules.profile.id,
      executionModel: execution.id,
    },
    provider,
    features: new AStockFeatureEngine(),
    models,
    primaryModelId: primary.id,
    schema,
    policy: createPolicy(config.policyId),
    rules,
    broker,
    execution,
    log: new PredictionLog(),
    symbol: config.symbol,
    horizonMs: config.horizonMs,
    flatBand: rules.profile.flatBand,
  };
  const times = decisionTimes(quotes, config.symbol, config.intervalMs);
  return {
    config,
    pipeline,
    quotes,
    times,
    runBatch: () => runSeries(pipeline, times),
    runPaper: async (onTick) => {
      const ticks: TickRecord[] = [];
      if (config.data === "ifind") {
        const live = provider as IFindMarketDataProvider;
        const asOf = Date.now();
        await live.poll([config.symbol], asOf);
        const tick = await runStep(pipeline, asOf);
        ticks.push(tick);
        onTick(tick);
      } else {
        for (const ts of times) {
          const tick = await runStep(pipeline, ts);
          ticks.push(tick);
          onTick(tick);
        }
      }
      return finalize(pipeline, ticks);
    },
  };
}

function makeProvider(config: AppConfig): { provider: MarketDataProvider; quotes: RawQuote[] } {
  if (config.data === "csv") {
    if (!config.csvPath) throw new Error("CSV_PATH is required when DATA=csv");
    const csv = readFileSync(config.csvPath, "utf8");
    const provider = new CsvMarketDataProvider(csv);
    return { provider, quotes: provider.history(config.symbol, Number.POSITIVE_INFINITY) };
  }
  if (config.data === "ifind") {
    if (!config.ifindEndpoint) throw new Error("IFIND_ENDPOINT is required when DATA=ifind");
    return {
      provider: new IFindMarketDataProvider({
        endpoint: config.ifindEndpoint,
        accessToken: config.ifindAccessToken,
        refreshToken: config.ifindRefreshToken,
      }),
      quotes: [],
    };
  }
  const quotes = buildSampleTape({ symbol: config.symbol });
  return { provider: new MockMarketDataProvider(quotes), quotes };
}

function configFor(id: string, config: AppConfig): ModelRuntimeConfig {
  if (id === config.modelId) return config.model;
  return {};
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export type { DecisionModel };

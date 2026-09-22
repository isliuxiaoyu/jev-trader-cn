import { DecisionError, type ModelRuntimeConfig } from "./decision/types";
import { getRegistration } from "./decision/registry";
import { registerBuiltinModels } from "./models/register";

export interface AppConfig {
  modelId: string;
  compareModelIds: string[];
  mode: "replay" | "backtest" | "paper";
  data: "mock" | "csv" | "ifind";
  symbol: string;
  schemaId: string;
  policyId: string;
  rulesId: string;
  executionId: string;
  horizonMs: number;
  intervalMs: number;
  port: number;
  cash: number;
  experimentId: string;
  dataset: string;
  csvPath?: string;
  ifindEndpoint?: string;
  ifindAccessToken?: string;
  ifindRefreshToken?: string;
  model: ModelRuntimeConfig;
  ignoredParams: string[];
}

const SHARED_KEYS = ["endpoint", "path", "revision", "device", "dtype", "maxInputTokens", "timeoutMs", "cache", "baseModel", "adapterId", "temperature", "apiKey", "remoteModel"] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env.REAL_BROKER === "true") {
    throw new DecisionError("Real broker is disabled. Paper trading is the only execution path in this phase.");
  }
  registerBuiltinModels();
  const modelId = env.MODEL || "baseline-momentum";
  const registration = getRegistration(modelId);
  const bag = readBag(env);
  const model: ModelRuntimeConfig = {};
  const ignored: string[] = [];
  for (const key of SHARED_KEYS) {
    const value = bag[key];
    if (value == null || value === "") continue;
    if (!registration.parameters.includes(key)) {
      ignored.push(key);
      continue;
    }
    assign(model, key, value);
  }
  const mode = env.MODE || "replay";
  if (mode !== "replay" && mode !== "backtest" && mode !== "paper") throw new DecisionError(`unknown MODE ${mode}`);
  const data = env.DATA || "mock";
  if (data !== "mock" && data !== "csv" && data !== "ifind") throw new DecisionError(`unknown DATA ${data}`);
  return {
    modelId,
    compareModelIds: (env.COMPARE_MODELS || "").split(",").map((s) => s.trim()).filter((s) => s.length > 0 && s !== modelId),
    mode,
    data,
    symbol: env.SYMBOL || "600519.SH",
    schemaId: env.SCHEMA || "direction_5m_v1",
    policyId: env.POLICY || "threshold-v1",
    rulesId: env.RULES || "AStock-MainBoard-v1",
    executionId: env.EXECUTION || "BestAskPlusSlippage",
    horizonMs: Number(env.HORIZON_MS || 300_000),
    intervalMs: Number(env.DECISION_INTERVAL_MS || 60_000),
    port: Number(env.PORT || 3000),
    cash: Number(env.CASH || 200_000),
    experimentId: env.EXPERIMENT_ID || "2026-A-001",
    dataset: env.DATASET || (data === "mock" ? "sample-tape-v1" : data),
    csvPath: env.CSV_PATH,
    ifindEndpoint: env.IFIND_ENDPOINT,
    ifindAccessToken: env.IFIND_ACCESS_TOKEN,
    ifindRefreshToken: env.IFIND_REFRESH_TOKEN,
    model,
    ignoredParams: ignored,
  };
}

function readBag(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return {
    endpoint: env.MODEL_ENDPOINT,
    path: env.MODEL_PATH,
    revision: env.MODEL_REVISION,
    device: env.MODEL_DEVICE,
    dtype: env.MODEL_DTYPE,
    maxInputTokens: env.MODEL_MAX_INPUT_TOKENS,
    timeoutMs: env.MODEL_TIMEOUT_MS,
    cache: env.MODEL_CACHE,
    baseModel: env.MODEL_BASE,
    adapterId: env.MODEL_ADAPTER,
    temperature: env.MODEL_TEMPERATURE,
    apiKey: env.TYPESAFE_AI_API_KEY || env.MODEL_API_KEY,
    remoteModel: env.MODEL_REMOTE || env.JEV_MODEL_ID,
  };
}

function assign(model: ModelRuntimeConfig, key: string, value: string): void {
  if (key === "maxInputTokens" || key === "timeoutMs") {
    model[key] = Number(value);
    return;
  }
  if (key === "cache") {
    model.cache = value === "true";
    return;
  }
  if (key === "temperature") {
    model.temperature = Number(value);
    return;
  }
  (model as Record<string, string>)[key] = value;
}

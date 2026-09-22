import { registerModel, type ModelExtras } from "../decision/registry";
import type { ModelRuntimeConfig } from "../decision/types";
import { MomentumBaseline, RandomBaseline } from "./baselines";
import { JevDecisionModel } from "./jev";
import { LLMDecisionModel } from "./llm";
import { AGENT_JEV_SPEC, DECIDER_SPEC, NIMBLE_9B_SPEC, NIMBLE_SPEC, TypedDecisionModel, type TypedModelSpec } from "./typed";

let registered = false;

export function registerBuiltinModels(): void {
  if (registered) return;
  registered = true;
  registerTyped(AGENT_JEV_SPEC);
  registerTyped(NIMBLE_SPEC);
  registerTyped({
    ...NIMBLE_9B_SPEC,
    capabilities: { ...NIMBLE_9B_SPEC.capabilities },
  });
  registerTyped(DECIDER_SPEC);
  registerModel(
    { id: "jev", name: "TypeSafe Jev", type: "typed-decision", provider: "typesafe", capabilities: new JevDecisionModel().capabilities, parameters: ["remoteModel", "timeoutMs", "apiKey"] },
    (config, extras) => new JevDecisionModel(config, extras?.jevEvaluate),
  );
  registerModel(
    { id: "llm", name: "LLM decision adapter", type: "text-model", provider: "openai-compatible", capabilities: new LLMDecisionModel().capabilities, parameters: ["endpoint", "remoteModel", "temperature", "timeoutMs", "apiKey"] },
    (config) => new LLMDecisionModel(config),
  );
  registerModel(
    { id: "baseline-momentum", name: "Momentum baseline", type: "baseline", provider: "local", capabilities: new MomentumBaseline().capabilities, parameters: [] },
    () => new MomentumBaseline(),
  );
  registerModel(
    { id: "baseline-random", name: "Random baseline", type: "baseline", provider: "local", capabilities: new RandomBaseline().capabilities, parameters: [] },
    () => new RandomBaseline(),
  );
}

function registerTyped(spec: TypedModelSpec): void {
  registerModel(
    { id: spec.id, name: spec.name, type: spec.type, provider: spec.provider, capabilities: spec.capabilities, parameters: spec.parameters },
    (config: ModelRuntimeConfig, extras?: ModelExtras) => new TypedDecisionModel(spec, withNimbleDefaults(spec, config), extras?.backend),
  );
}

function withNimbleDefaults(spec: TypedModelSpec, config: ModelRuntimeConfig): ModelRuntimeConfig {
  if (!spec.capabilities.requiresBaseModel) return config;
  return {
    ...config,
    baseModel: config.baseModel || "Qwen/Qwen3.5-9B",
    adapterId: config.adapterId || "bespokelabs/Bespoke-Nimble-9B",
  };
}

export function resetBuiltinRegistration(): void {
  registered = false;
}

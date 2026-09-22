import { DecisionError, type DecisionModel, type ModelRegistration, type ModelRuntimeConfig } from "./types";

export interface ModelExtras {
  backend?: InferenceBackend;
  jevEvaluate?: JevEvaluate;
}

export interface InferenceBackend {
  infer(request: import("./types").DecisionRequest, model: DecisionModel): Promise<import("./types").RawInference>;
}

export interface JevEvaluate {
  (args: { state: unknown; questions: Record<string, unknown>; modelId: string }): Promise<{
    answers: Record<string, { choice?: string; probabilities?: Record<string, number>; probability?: number; score?: number }>;
    usage?: { inputTokens?: number };
  }>;
}

export type ModelFactory = (config: ModelRuntimeConfig, extras?: ModelExtras) => DecisionModel;

const factories = new Map<string, ModelFactory>();
const catalog = new Map<string, ModelRegistration>();

export function registerModel(registration: ModelRegistration, factory: ModelFactory): void {
  factories.set(registration.id, factory);
  catalog.set(registration.id, registration);
}

export function createModel(id: string, config: ModelRuntimeConfig = {}, extras?: ModelExtras): DecisionModel {
  const factory = factories.get(id);
  if (!factory) {
    throw new DecisionError(`unknown model ${id}. registered: ${[...catalog.keys()].join(", ") || "(none)"}`);
  }
  return factory(config, extras);
}

export function getRegistration(id: string): ModelRegistration {
  const found = catalog.get(id);
  if (!found) throw new DecisionError(`unknown model ${id}`);
  return found;
}

export function listModels(): ModelRegistration[] {
  return [...catalog.values()];
}

export function resetRegistry(): void {
  factories.clear();
  catalog.clear();
}

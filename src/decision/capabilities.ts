import { DecisionError, type DecisionModel, type DecisionSchema, type ModelCapabilities } from "./types";

/** Reject a schema the model cannot answer. This runs before any inference call. */
export function assertCanRun(model: Pick<DecisionModel, "id" | "capabilities">, schema: DecisionSchema): void {
  const caps: ModelCapabilities = model.capabilities;
  for (const q of schema.questions) {
    if (q.type === "choice" && !caps.supportsChoice) {
      throw new DecisionError(`[ADAPTER LIMITATION] ${model.id} does not support choice questions (${q.id})`);
    }
    if (q.type === "boolean" && !caps.supportsBoolean) {
      throw new DecisionError(`[ADAPTER LIMITATION] ${model.id} does not support boolean questions (${q.id})`);
    }
    if (q.type === "score" && !caps.supportsScore) {
      throw new DecisionError(`[ADAPTER LIMITATION] ${model.id} does not support score questions (${q.id})`);
    }
  }
  if (schema.requiresDistribution && !caps.supportsProbabilities) {
    throw new DecisionError(`[ADAPTER LIMITATION] ${model.id} does not return a candidate probability distribution required by ${schema.id}`);
  }
}

import { assertCanRun } from "../decision/capabilities";
import { buildResponse } from "../decision/response";
import type { JevEvaluate } from "../decision/registry";
import type { DecisionModel, DecisionQuestion, DecisionRequest, DecisionResponse, ModelCapabilities, ModelRuntimeConfig, RawAnswer } from "../decision/types";

const CAP: ModelCapabilities = {
  supportsChoice: true,
  supportsBoolean: true,
  supportsScore: true,
  supportsProbabilities: true,
  supportsLocalInference: false,
  supportsStreaming: false,
  maxContextTokens: 8192,
  latencyClass: "low",
  requiresBaseModel: false,
};

/** TypeSafe Jev via the AI SDK evaluation API. One typed call, not a chat completion. */
export class JevDecisionModel implements DecisionModel {
  readonly id = "jev";
  readonly name = "TypeSafe Jev";
  readonly type = "typed-decision";
  readonly provider = "typesafe";
  readonly capabilities = CAP;
  readonly parameters = ["remoteModel", "timeoutMs", "apiKey"] as const;
  readonly version: string;
  private readonly evaluateFn: JevEvaluate | undefined;

  constructor(config: ModelRuntimeConfig = {}, evaluateFn?: JevEvaluate) {
    this.version = config.remoteModel || "jev-latest";
    this.evaluateFn = evaluateFn;
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    assertCanRun(this, request.schema);
    const t0 = performance.now();
    const questions = toJevQuestions(request.schema.questions);
    const evaluated = this.evaluateFn
      ? await this.evaluateFn({ state: request.state.features, questions, modelId: this.version })
      : await callSdk(request, questions, this.version);
    const answers: RawAnswer[] = request.schema.questions.map((q) => {
      const row = evaluated.answers[q.id];
      if (!row) return { id: q.id };
      if (q.type === "boolean") return { id: q.id, value: row.probability, distribution: typeof row.probability === "number" ? { true: row.probability, false: 1 - row.probability } : undefined };
      if (q.type === "score") return { id: q.id, score: row.score, distribution: row.probabilities };
      return { id: q.id, value: row.choice, distribution: row.probabilities };
    });
    return buildResponse(this, request, { answers, metadata: { inputTokens: evaluated.usage?.inputTokens ?? null, protocol: "typesafe.evaluate" } }, performance.now() - t0);
  }
}

function toJevQuestions(questions: DecisionQuestion[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of questions) {
    if (q.type === "choice") {
      const criteria: Record<string, string> = {};
      for (const opt of q.options) criteria[opt.id] = opt.description;
      out[q.id] = { type: "choice", instructions: q.prompt, criteria };
    } else if (q.type === "boolean") {
      out[q.id] = { type: "boolean", instructions: q.prompt, criteria: { true: q.trueCriteria, false: q.falseCriteria } };
    } else {
      out[q.id] = { type: "score", instructions: q.prompt, criteria: q.levels.map((level) => level.description) };
    }
  }
  return out;
}

async function callSdk(request: DecisionRequest, questions: Record<string, unknown>, modelId: string) {
  const [{ experimental_evaluate }, { typeSafeAi }] = await Promise.all([import("ai"), import("@ai-sdk/typesafe-ai")]);
  const result = await experimental_evaluate({
    model: typeSafeAi.evaluationModel(modelId),
    state: request.state.features as Record<string, string | number | boolean | null>,
    questions: questions as never,
    maxRetries: 0,
  });
  const answers: Record<string, { choice?: string; probabilities?: Record<string, number>; probability?: number; score?: number }> = {};
  for (const [id, answer] of Object.entries(result.answers)) {
    const row = answer as { choice?: string; probabilities?: Record<string, number>; probability?: number; score?: number };
    answers[id] = row;
  }
  return { answers, usage: { inputTokens: result.usage?.inputTokens } };
}

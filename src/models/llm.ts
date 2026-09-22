import { assertCanRun } from "../decision/capabilities";
import { buildResponse } from "../decision/response";
import { DecisionError, type DecisionModel, type DecisionRequest, type DecisionResponse, type ModelCapabilities, type ModelRuntimeConfig } from "../decision/types";
import { parseOpenAIContent } from "./parsers";

const CAP: ModelCapabilities = {
  supportsChoice: true,
  supportsBoolean: true,
  supportsScore: true,
  supportsProbabilities: false,
  supportsLocalInference: true,
  supportsStreaming: false,
  maxContextTokens: 8192,
  latencyClass: "high",
  requiresBaseModel: false,
};

/**
 * OpenAI-compatible chat endpoint (vLLM, Ollama, hosted APIs).
 * Marked TEXT MODEL: it does not claim a native candidate distribution.
 * Schemas that require a distribution are rejected before the call.
 */
export class LLMDecisionModel implements DecisionModel {
  readonly id = "llm";
  readonly name = "LLM decision adapter";
  readonly type = "text-model";
  readonly provider = "openai-compatible";
  readonly capabilities = CAP;
  readonly parameters = ["endpoint", "remoteModel", "temperature", "timeoutMs", "apiKey"] as const;
  readonly version: string;

  constructor(private readonly config: ModelRuntimeConfig = {}) {
    this.version = config.remoteModel || "llm";
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    assertCanRun(this, request.schema);
    if (!this.config.endpoint) {
      throw new DecisionError("[TEXT MODEL] LLMDecisionModel needs MODEL_ENDPOINT (OpenAI-compatible /v1 root or full chat URL).");
    }
    const t0 = performance.now();
    const url = this.config.endpoint.endsWith("/chat/completions")
      ? this.config.endpoint
      : `${this.config.endpoint.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.version,
        temperature: this.config.temperature ?? 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a typed decision function. Reply with JSON only: {\"answers\":[{\"id\":\"...\",\"value\":\"OPTION\"}]}. Do not invent a calibrated probability distribution. A point label is enough.",
          },
          { role: "user", content: JSON.stringify({ state: request.state.features, questions: request.schema.questions }) },
        ],
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
    });
    if (!res.ok) throw new DecisionError(`[TEXT MODEL] llm http ${res.status}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new DecisionError("[TEXT MODEL] empty completion");
    const raw = parseOpenAIContent(content);
    raw.metadata = { ...(raw.metadata ?? {}), adapterClass: "TEXT MODEL" };
    return buildResponse(this, request, raw, performance.now() - t0);
  }
}

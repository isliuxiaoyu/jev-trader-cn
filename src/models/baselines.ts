import { assertCanRun } from "../decision/capabilities";
import { buildResponse } from "../decision/response";
import type { DecisionModel, DecisionRequest, DecisionResponse, ModelCapabilities, RawInference } from "../decision/types";
import { questionOptionIds } from "../decision/schema";

const CAP: ModelCapabilities = {
  supportsChoice: true,
  supportsBoolean: true,
  supportsScore: true,
  supportsProbabilities: true,
  supportsLocalInference: true,
  supportsStreaming: false,
  maxContextTokens: 2048,
  latencyClass: "low",
  requiresBaseModel: false,
};

export class MomentumBaseline implements DecisionModel {
  readonly id = "baseline-momentum";
  readonly name = "Momentum baseline";
  readonly version = "momentum-v1";
  readonly type = "baseline";
  readonly provider = "local";
  readonly capabilities = CAP;
  readonly parameters = [] as const;

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    assertCanRun(this, request.schema);
    const t0 = performance.now();
    const ret = num(request.state.features.return5m);
    const vol = num(request.state.features.volatility);
    const answers = request.schema.questions.map((q) => {
      const options = questionOptionIds(q);
      if (q.type === "boolean") {
        const tradable = request.state.features.suspended !== true && request.state.features.limitUp !== true && request.state.features.limitDown !== true && Math.abs(ret) > 0.0005;
        const yes = tradable ? 0.7 : 0.3;
        return { id: q.id, distribution: { YES: yes, NO: 1 - yes } };
      }
      if (q.type === "score") {
        const level = vol > 0.002 ? "HIGH" : vol > 0.0005 ? "MEDIUM" : "LOW";
        return { id: q.id, distribution: softmaxToward(options, level, 1.2) };
      }
      if (options.includes("BUY")) {
        const target = ret > 0.0008 ? "BUY" : ret < -0.0008 ? "SELL" : "HOLD";
        return { id: q.id, distribution: softmaxToward(options, target, 1.4) };
      }
      if (options.includes("STRONG_UP")) {
        const target = ret > 0.003 ? "STRONG_UP" : ret > 0.0008 ? "UP" : ret < -0.003 ? "STRONG_DOWN" : ret < -0.0008 ? "DOWN" : "FLAT";
        return { id: q.id, distribution: softmaxToward(options, target, 1.3) };
      }
      const target = ret > 0.0008 ? "UP" : ret < -0.0008 ? "DOWN" : "FLAT";
      return { id: q.id, distribution: softmaxToward(options, target, 1.5) };
    });
    return buildResponse(this, request, { answers, metadata: { family: "baseline" } } satisfies RawInference, performance.now() - t0);
  }
}

export class RandomBaseline implements DecisionModel {
  readonly id = "baseline-random";
  readonly name = "Random baseline";
  readonly version = "random-v1";
  readonly type = "baseline";
  readonly provider = "local";
  readonly capabilities = CAP;
  readonly parameters = [] as const;

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    assertCanRun(this, request.schema);
    const t0 = performance.now();
    const answers = request.schema.questions.map((q) => {
      const options = questionOptionIds(q);
      const distribution: Record<string, number> = {};
      for (const opt of options) {
        distribution[opt] = 0.5 + hashUnit(`${request.state.symbol}|${request.state.timestamp}|${q.id}|${opt}`);
      }
      return { id: q.id, distribution };
    });
    return buildResponse(this, request, { answers, metadata: { family: "baseline" } }, performance.now() - t0);
  }
}

function num(value: number | string | boolean | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function softmaxToward(options: string[], target: string, sharpness: number): Record<string, number> {
  const weights: Record<string, number> = {};
  let sum = 0;
  for (const opt of options) {
    const w = Math.exp(opt === target ? sharpness : 0);
    weights[opt] = w;
    sum += w;
  }
  const out: Record<string, number> = {};
  for (const opt of options) out[opt] = weights[opt]! / sum;
  return out;
}

function hashUnit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

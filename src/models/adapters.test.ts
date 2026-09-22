import { beforeEach, expect, test } from "bun:test";
import { createModel, listModels } from "../decision/registry";
import { getSchema } from "../decision/schema";
import type { DecisionRequest, RawInference } from "../decision/types";
import { parseAgentJevResponse, parseNimbleResponse, parseOpenAIContent } from "./parsers";
import { registerBuiltinModels } from "./register";

beforeEach(() => {
  registerBuiltinModels();
});
import { MomentumBaseline, RandomBaseline } from "./baselines";

const request: DecisionRequest = {
  asOf: 1,
  schema: getSchema("direction_5m_v1"),
  state: {
    symbol: "600000.SH",
    timestamp: 1,
    featureVersion: "v1",
    features: { return5m: 0.01, volatility: 0.001, suspended: false, limitUp: false, limitDown: false },
    text: "{}",
  },
};

function fixture(distribution: Record<string, number>): RawInference {
  return {
    answers: [
      { id: "direction_5m", distribution },
      { id: "tradeability", distribution: { true: 0.8, false: 0.2 } },
    ],
  };
}

test("registry switches models without a strategy branch", async () => {
  const ids = listModels().map((m) => m.id);
  expect(ids).toContain("agent-jev");
  expect(ids).toContain("nimble-9b");
  expect(ids).toContain("baseline-momentum");
  expect(ids).toContain("jev");
  expect(ids).toContain("decider-2b");
  const backend = { async infer() { return fixture({ UP: 0.7, FLAT: 0.2, DOWN: 0.1 }); } };
  for (const id of ["agent-jev", "nimble", "nimble-9b", "decider-2b"]) {
    const model = createModel(id, {}, { backend });
    const response = await model.decide(request);
    expect(response.model).toBe(id);
    const direction = response.answers.find((a) => a.questionId === "direction_5m");
    expect(direction?.type).toBe("choice");
    if (direction?.type !== "choice") throw new Error("expected choice");
    expect(direction.probabilities.UP).toBeCloseTo(0.7);
    expect(direction?.topProbability).toBeCloseTo(0.7);
    expect(direction?.margin).toBeCloseTo(0.5);
    expect(response.modelVersion.length).toBeGreaterThan(0);
  }
  const nimble = createModel("nimble-9b", {});
  expect(nimble.capabilities.requiresBaseModel).toBe(true);
  expect(nimble.version).toContain("Qwen/Qwen3.5-9B");
  expect(nimble.parameters.includes("temperature")).toBe(false);
  await expect(nimble.decide(request)).rejects.toThrow(/ADAPTER LIMITATION/);
});

test("agentjev and nimble parsers keep the published envelopes", () => {
  const agent = parseAgentJevResponse({
    api_version: "agentjev.decision.v1",
    results: [{
      id: "0",
      answers: [
        { id: "direction_5m", type: "choice", value: "UP", top_probability: 0.7, margin: 0.5, distribution: { UP: 0.7, FLAT: 0.2, DOWN: 0.1 } },
        { id: "tradeability", type: "boolean", probability: 0.2, value: false, distribution: { true: 0.2, false: 0.8 } },
      ],
    }],
    usage: { generated_tokens: 0 },
  });
  expect(agent.answers[0]?.distribution?.UP).toBe(0.7);
  expect(agent.metadata?.generatedTokens).toBe(0);
  const nimble = parseNimbleResponse({
    output: { direction_5m: "UP" },
    fields: { direction_5m: { probabilities: { UP: 0.55, FLAT: 0.4, DOWN: 0.05 } } },
  });
  expect(nimble.answers[0]?.distribution?.FLAT).toBe(0.4);
  const text = parseOpenAIContent(JSON.stringify({ answers: [{ id: "direction_5m", value: "UP" }] }));
  expect(text.metadata?.adapterClass).toBe("TEXT MODEL");
});

test("baselines return full distributions", async () => {
  const momentum = await new MomentumBaseline().decide(request);
  const random = await new RandomBaseline().decide(request);
  const a = momentum.answers[0]!;
  const b = random.answers[0]!;
  expect(a.type).toBe("choice");
  if (a.type === "choice") expect(Object.values(a.probabilities).reduce((s, n) => s + n, 0)).toBeCloseTo(1);
  if (b.type === "choice") expect(Object.values(b.probabilities).reduce((s, n) => s + n, 0)).toBeCloseTo(1);
  expect(a.selectedValue).toBe("UP");
});

test("jev adapter keeps the typed distribution from the evaluation API", async () => {
  const model = createModel("jev", { remoteModel: "jev-test" }, {
    jevEvaluate: async () => ({
      answers: {
        direction_5m: { choice: "DOWN", probabilities: { UP: 0.1, FLAT: 0.2, DOWN: 0.7 } },
        tradeability: { probability: 0.4 },
      },
    }),
  });
  const response = await model.decide(request);
  expect(response.modelVersion).toBe("jev-test");
  const direction = response.answers[0];
  expect(direction?.type).toBe("choice");
  if (direction?.type !== "choice") throw new Error("expected choice");
  expect(direction.selectedValue).toBe("DOWN");
  expect(direction.probabilities.DOWN).toBeCloseTo(0.7);
  expect(direction.margin).toBeCloseTo(0.5);
});

test("text model is refused on a distribution schema", async () => {
  const llm = createModel("llm", { endpoint: "http://127.0.0.1:9" });
  await expect(llm.decide(request)).rejects.toThrow(/ADAPTER LIMITATION/);
});

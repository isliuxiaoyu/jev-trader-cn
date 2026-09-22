import { assertCanRun } from "./capabilities";
import { booleanMasses, normalizeProbabilities, pointMass, topAndMargin } from "./normalizer";
import { questionOptionIds } from "./schema";
import {
  DecisionError,
  type BooleanAnswer,
  type ChoiceAnswer,
  type DecisionModel,
  type DecisionRequest,
  type DecisionResponse,
  type RawInference,
  type ScoreAnswer,
  type TypedAnswer,
} from "./types";

export function buildResponse(model: Pick<DecisionModel, "id" | "version" | "capabilities">, request: DecisionRequest, raw: RawInference, latencyMs: number): DecisionResponse {
  assertCanRun(model, request.schema);
  const answers: TypedAnswer[] = [];
  for (const q of request.schema.questions) {
    const found = raw.answers.find((a) => a.id === q.id);
    if (!found) throw new DecisionError(`${model.id} omitted an answer for ${q.id}`);
    if (q.type === "boolean") answers.push(booleanAnswer(model, q.id, found));
    else if (q.type === "choice") answers.push(choiceAnswer(model, q.id, questionOptionIds(q), found));
    else answers.push(scoreAnswer(model, q.id, questionOptionIds(q), found));
  }
  return {
    model: model.id,
    modelVersion: model.version,
    schemaId: request.schema.id,
    answers,
    latencyMs,
    metadata: {
      ...(raw.metadata ?? {}),
      nativeDistribution: model.capabilities.supportsProbabilities,
      note: "topProbability is the selected candidate's mass inside the option set, not a calibrated success probability",
    },
  };
}

function choiceAnswer(model: Pick<DecisionModel, "id" | "capabilities">, id: string, options: string[], found: RawInference["answers"][number]): ChoiceAnswer {
  const probabilities = distributionFor(model, id, options, found);
  const top = topAndMargin(probabilities, options);
  return { questionId: id, type: "choice", options, probabilities, selectedValue: top.selected, topProbability: top.topProbability, margin: top.margin };
}

function booleanAnswer(model: Pick<DecisionModel, "id" | "capabilities">, id: string, found: RawInference["answers"][number]): BooleanAnswer {
  let masses: { YES: number; NO: number };
  if (found.distribution || typeof found.value === "number") {
    const pTrue = typeof found.value === "number" ? found.value : undefined;
    masses = booleanMasses(found.distribution, pTrue);
  } else if (typeof found.value === "boolean" || found.value === "YES" || found.value === "NO") {
    if (model.capabilities.supportsProbabilities) {
      throw new DecisionError(`[ADAPTER LIMITATION] ${model.id} returned a point boolean for ${id} without a distribution`);
    }
    const yes = found.value === true || found.value === "YES";
    masses = { YES: yes ? 1 : 0, NO: yes ? 0 : 1 };
  } else {
    throw new DecisionError(`${model.id} boolean answer ${id} is incomplete`);
  }
  const probabilities = { YES: masses.YES, NO: masses.NO };
  const top = topAndMargin(probabilities, ["YES", "NO"]);
  return {
    questionId: id,
    type: "boolean",
    options: ["YES", "NO"],
    probabilities,
    selectedValue: top.selected as "YES" | "NO",
    topProbability: top.topProbability,
    margin: top.margin,
  };
}

function scoreAnswer(model: Pick<DecisionModel, "id" | "capabilities">, id: string, levels: string[], found: RawInference["answers"][number]): ScoreAnswer {
  let probabilities: Record<string, number>;
  if (found.distribution && looksIndexed(found.distribution) && !levels.some((level) => level in found.distribution!)) {
    const mapped: Record<string, number> = {};
    levels.forEach((level, i) => {
      mapped[level] = found.distribution?.[String(i)] ?? 0;
    });
    probabilities = normalizeProbabilities(mapped, levels);
  } else {
    probabilities = distributionFor(model, id, levels, found);
  }
  const top = topAndMargin(probabilities, levels);
  let score = 0;
  levels.forEach((level, i) => {
    score += i * (probabilities[level] ?? 0);
  });
  if (typeof found.score === "number" && Number.isFinite(found.score)) score = found.score;
  return { questionId: id, type: "score", levels, probabilities, selectedValue: top.selected, score, topProbability: top.topProbability, margin: top.margin };
}

function distributionFor(model: Pick<DecisionModel, "id" | "capabilities">, id: string, options: string[], found: RawInference["answers"][number]): Record<string, number> {
  if (found.distribution && Object.keys(found.distribution).length > 0) {
    return normalizeProbabilities(found.distribution, options);
  }
  if (!model.capabilities.supportsProbabilities && typeof found.value === "string") {
    return pointMass(found.value, options);
  }
  throw new DecisionError(`[ADAPTER LIMITATION] ${model.id} did not return a probability distribution for ${id}`);
}

function looksIndexed(dist: Record<string, number>): boolean {
  return Object.keys(dist).every((k) => /^\d+$/.test(k));
}

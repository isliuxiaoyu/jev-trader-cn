import { DecisionError, type DecisionQuestion, type DecisionRequest, type RawAnswer, type RawInference } from "../decision/types";

/** Official AgentJev `POST /api/evaluate` body. Question ids are for matching, not shown as a ranking. */
export function toAgentJevBody(request: DecisionRequest): unknown {
  return {
    state: {
      symbol: request.state.symbol,
      timestamp: request.state.timestamp,
      featureVersion: request.state.featureVersion,
      features: request.state.features,
    },
    questions: request.schema.questions.map(toAgentJevQuestion),
  };
}

export function toAgentJevQuestion(q: DecisionQuestion): unknown {
  if (q.type === "choice") {
    const options: Record<string, string> = {};
    for (const opt of q.options) options[opt.id] = opt.description;
    return { id: q.id, type: "choice", question: q.prompt, options };
  }
  if (q.type === "boolean") {
    return {
      id: q.id,
      type: "boolean",
      question: q.prompt,
      criteria: { true: q.trueCriteria, false: q.falseCriteria },
    };
  }
  return { id: q.id, type: "score", question: q.prompt, levels: q.levels.map((level) => level.description) };
}

export function parseAgentJevResponse(body: unknown): RawInference {
  const root = asRecord(body);
  const results = Array.isArray(root.results) ? root.results : null;
  const first = results ? asRecord(results[0]) : root;
  const answers = Array.isArray(first.answers) ? first.answers : null;
  if (!answers) throw new DecisionError("[ADAPTER LIMITATION] response is not an AgentJev evaluate envelope");
  return {
    answers: answers.map(parseAgentJevAnswer),
    metadata: { protocol: "agentjev.decision.v1", generatedTokens: asRecord(root.usage).generated_tokens ?? 0 },
  };
}

function parseAgentJevAnswer(value: unknown): RawAnswer {
  const row = asRecord(value);
  const id = String(row.id ?? "");
  const distribution = asNumRecord(row.distribution);
  if (row.type === "boolean") {
    const p = typeof row.probability === "number" ? row.probability : undefined;
    return { id, distribution: distribution ?? (p == null ? undefined : { true: p, false: 1 - p }), value: typeof row.value === "boolean" ? row.value : p };
  }
  if (row.type === "score") {
    return { id, distribution, score: typeof row.score === "number" ? row.score : undefined, value: primitive(row.level) };
  }
  return { id, distribution, value: typeof row.value === "string" ? row.value : undefined };
}

/** Nimble scores allowed answer tokens. The 9B artifact is a LoRA on Qwen3.5-9B, so the body names both. */
export function toNimbleBody(request: DecisionRequest, baseModel: string | undefined, adapterId: string | undefined): unknown {
  const schema: Record<string, unknown> = {};
  const scoreFields: string[] = [];
  for (const q of request.schema.questions) {
    if (q.type === "choice") {
      schema[q.id] = {
        type: "enum",
        description: q.prompt,
        choices: q.options.map((o) => o.id),
        choice_descriptions: Object.fromEntries(q.options.map((o) => [o.id, o.description])),
      };
    } else if (q.type === "boolean") {
      schema[q.id] = { type: "boolean", description: q.prompt };
    } else {
      schema[q.id] = {
        type: "enum",
        description: q.prompt,
        choices: q.levels.map((_, i) => String(i)),
        choice_descriptions: Object.fromEntries(q.levels.map((level, i) => [String(i), level.description])),
      };
      scoreFields.push(q.id);
    }
  }
  return {
    base_model: baseModel,
    adapter: adapterId,
    context: request.state.text,
    schema,
    score_fields: scoreFields,
  };
}

export function parseNimbleResponse(body: unknown): RawInference {
  const root = asRecord(body);
  if (Array.isArray(root.results) || Array.isArray(root.answers)) return parseAgentJevResponse(body);
  const fields = asRecord(root.fields);
  if (Object.keys(fields).length === 0 && !root.choices && !root.nouls) {
    throw new DecisionError("[ADAPTER LIMITATION] response is not a Nimble score envelope");
  }
  const answers: RawAnswer[] = [];
  if (Object.keys(fields).length > 0) {
    for (const [id, value] of Object.entries(fields)) {
      const field = asRecord(value);
      answers.push({
        id,
        distribution: asNumRecord(field.probabilities),
        value: primitive(field.value ?? asRecord(root.output)[id]),
        score: typeof field.expected_score === "number" ? field.expected_score : typeof field.score === "number" ? field.score : undefined,
      });
    }
    return { answers, metadata: { protocol: "nimble.score.v1" } };
  }
  const choices = asRecord(root.choices);
  const nouls = asRecord(root.nouls);
  const scores = asRecord(root.scores);
  for (const [id, value] of Object.entries(choices)) {
    const row = asRecord(value);
    answers.push({ id, distribution: asNumRecord(row.probabilities), value: primitive(row.choice) });
  }
  for (const [id, value] of Object.entries(nouls)) {
    const row = asRecord(value);
    const p = typeof row.noul === "number" ? row.noul : undefined;
    answers.push({ id, distribution: p == null ? undefined : { true: p, false: 1 - p }, value: p });
  }
  for (const [id, value] of Object.entries(scores)) {
    const row = asRecord(value);
    answers.push({ id, distribution: asNumRecord(row.probabilities), score: typeof row.score === "number" ? row.score : undefined });
  }
  return { answers, metadata: { protocol: "nimble.systemone.v1" } };
}

export function parseOpenAIContent(content: string): RawInference {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DecisionError("[TEXT MODEL] LLM output was not JSON");
  }
  const root = asRecord(parsed);
  const answers = Array.isArray(root.answers) ? root.answers : null;
  if (!answers) throw new DecisionError("[TEXT MODEL] LLM JSON has no answers array");
  return {
    answers: answers.map((item) => {
      const row = asRecord(item);
      return {
        id: String(row.id ?? ""),
        distribution: asNumRecord(row.probabilities ?? row.distribution),
        value: typeof row.value === "string" || typeof row.value === "boolean" || typeof row.value === "number" ? row.value : undefined,
      };
    }),
    metadata: { adapterClass: "TEXT MODEL", nativeDistribution: false },
  };
}

function primitive(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

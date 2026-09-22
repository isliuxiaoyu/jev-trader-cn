/** Pluggable typed decision contracts. Strategy code depends on these shapes only. */

export type QuestionType = "choice" | "boolean" | "score";

export interface ChoiceOption {
  id: string;
  description: string;
}

export interface ChoiceQuestion {
  id: string;
  type: "choice";
  prompt: string;
  options: ChoiceOption[];
}

export interface BooleanQuestion {
  id: string;
  type: "boolean";
  prompt: string;
  trueCriteria: string;
  falseCriteria: string;
}

export interface ScoreQuestion {
  id: string;
  type: "score";
  prompt: string;
  /** Lowest level first. The model scores this ordered rubric. */
  levels: ChoiceOption[];
}

export type DecisionQuestion = ChoiceQuestion | BooleanQuestion | ScoreQuestion;

export interface DecisionSchema {
  id: string;
  version: string;
  /** When true, a model that cannot return a candidate distribution is rejected before inference. */
  requiresDistribution: boolean;
  questions: DecisionQuestion[];
}

export type LatencyClass = "low" | "medium" | "high";

export interface ModelCapabilities {
  supportsChoice: boolean;
  supportsBoolean: boolean;
  supportsScore: boolean;
  supportsProbabilities: boolean;
  supportsLocalInference: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
  latencyClass: LatencyClass;
  /**
   * True when the artifact is a LoRA (or similar) that cannot be loaded without a base model.
   * Bespoke-Nimble-9B is an adapter, not a standalone checkpoint.
   */
  requiresBaseModel: boolean;
}

/** What an adapter actually reads. Generation temperature is absent when the model does not sample text. */
export interface ModelRuntimeConfig {
  endpoint?: string;
  path?: string;
  revision?: string;
  device?: string;
  dtype?: string;
  maxInputTokens?: number;
  timeoutMs?: number;
  cache?: boolean;
  baseModel?: string;
  adapterId?: string;
  temperature?: number;
  apiKey?: string;
  remoteModel?: string;
}

export interface NormalizedState {
  symbol: string;
  timestamp: number;
  featureVersion: string;
  features: Record<string, number | string | boolean | null>;
  /** Stable JSON of features. Text endpoints can encode this without seeing provider payloads. */
  text: string;
}

export interface DecisionRequest {
  state: NormalizedState;
  schema: DecisionSchema;
  /** Model input may only contain information that existed at this timestamp. */
  asOf: number;
}

export interface ChoiceAnswer {
  questionId: string;
  type: "choice";
  options: string[];
  probabilities: Record<string, number>;
  selectedValue: string;
  topProbability: number;
  margin: number;
}

export interface BooleanAnswer {
  questionId: string;
  type: "boolean";
  options: ["YES", "NO"];
  probabilities: { YES: number; NO: number };
  selectedValue: "YES" | "NO";
  topProbability: number;
  margin: number;
}

export interface ScoreAnswer {
  questionId: string;
  type: "score";
  levels: string[];
  probabilities: Record<string, number>;
  selectedValue: string;
  /** Probability-weighted level index, sum i * P(level_i). Not a success probability. */
  score: number;
  topProbability: number;
  margin: number;
}

export type TypedAnswer = ChoiceAnswer | BooleanAnswer | ScoreAnswer;

export interface DecisionResponse {
  model: string;
  modelVersion: string;
  schemaId: string;
  answers: TypedAnswer[];
  latencyMs: number;
  /**
   * topProbability is the probability of the chosen candidate inside the supplied set.
   * It is not a calibrated probability that the choice will be correct.
   */
  metadata: Record<string, unknown>;
}

export interface DecisionModel {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: string;
  readonly provider: string;
  readonly capabilities: ModelCapabilities;
  readonly parameters: readonly string[];
  decide(request: DecisionRequest): Promise<DecisionResponse>;
}

export interface ModelRegistration {
  id: string;
  name: string;
  type: string;
  provider: string;
  capabilities: ModelCapabilities;
  parameters: readonly string[];
}

export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionError";
  }
}

export interface RawAnswer {
  id: string;
  distribution?: Record<string, number>;
  /** Point label when the backend has no distribution. */
  value?: string | number | boolean;
  score?: number;
}

export interface RawInference {
  answers: RawAnswer[];
  metadata?: Record<string, unknown>;
}

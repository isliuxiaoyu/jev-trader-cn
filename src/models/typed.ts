import { assertCanRun } from "../decision/capabilities";
import { buildResponse } from "../decision/response";
import type { InferenceBackend } from "../decision/registry";
import {
  DecisionError,
  type DecisionModel,
  type DecisionRequest,
  type DecisionResponse,
  type ModelCapabilities,
  type ModelRuntimeConfig,
} from "../decision/types";
import { parseAgentJevResponse, parseNimbleResponse, toAgentJevBody, toNimbleBody } from "./parsers";

export type TypedProtocol = "agentjev" | "nimble";

export interface TypedModelSpec {
  id: string;
  name: string;
  version: string;
  type: string;
  provider: string;
  capabilities: ModelCapabilities;
  parameters: readonly string[];
  protocol: TypedProtocol;
}

const LOCAL_PARAMS = ["endpoint", "path", "revision", "device", "dtype", "maxInputTokens", "timeoutMs", "cache", "baseModel", "adapterId"] as const;

export const TYPED_CAPABILITIES: ModelCapabilities = {
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

export class HttpInferenceBackend implements InferenceBackend {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly protocol: TypedProtocol,
    private readonly config: ModelRuntimeConfig,
  ) {}

  async infer(request: DecisionRequest): Promise<import("../decision/types").RawInference> {
    const url = this.endpoint.replace(/\/$/, "");
    const path = this.protocol === "agentjev" ? "/api/evaluate" : "/api/evaluate";
    const body = this.protocol === "agentjev"
      ? toAgentJevBody(request)
      : toNimbleBody(request, this.config.baseModel, this.config.adapterId);
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new DecisionError(`${this.protocol} http ${res.status}`);
    const json = await res.json();
    return this.protocol === "agentjev" ? parseAgentJevResponse(json) : parseNimbleResponse(json);
  }
}

export class TypedDecisionModel implements DecisionModel {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: string;
  readonly provider: string;
  readonly capabilities: ModelCapabilities;
  readonly parameters: readonly string[];

  constructor(
    spec: TypedModelSpec,
    private readonly config: ModelRuntimeConfig,
    private readonly backend: InferenceBackend | undefined,
  ) {
    this.id = spec.id;
    this.name = spec.name;
    this.version = versionOf(spec, config);
    this.type = spec.type;
    this.provider = spec.provider;
    this.capabilities = spec.capabilities;
    this.parameters = spec.parameters;
    if (spec.capabilities.requiresBaseModel && !config.baseModel) {
      throw new DecisionError(`[ADAPTER LIMITATION] ${spec.id} is a LoRA adapter and needs MODEL_BASE (the base checkpoint is not inside the adapter repo)`);
    }
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    assertCanRun(this, request.schema);
    const backend = this.backend ?? defaultBackend(this.id, this.config, this.protocol());
    const t0 = performance.now();
    const raw = await backend.infer(request, this);
    const latency = performance.now() - t0;
    return buildResponse(this, request, raw, latency);
  }

  private protocol(): TypedProtocol {
    return this.capabilities.requiresBaseModel || this.id.startsWith("nimble") ? "nimble" : "agentjev";
  }
}

function versionOf(spec: TypedModelSpec, config: ModelRuntimeConfig): string {
  const rev = config.revision ? `@${config.revision}` : "";
  if (spec.capabilities.requiresBaseModel) {
    const base = config.baseModel ?? "missing-base";
    return `${spec.version}${rev}|base=${base}`;
  }
  return `${spec.version}${rev}`;
}

function defaultBackend(id: string, config: ModelRuntimeConfig, protocol: TypedProtocol): InferenceBackend {
  if (!config.endpoint) {
    throw new DecisionError(
      `[ADAPTER LIMITATION] ${id} has no inference backend. Set MODEL_ENDPOINT to a local typed-decision server. ` +
      "AgentJev is a candidate-head checkpoint (zero token decode), not a causal chat model. " +
      "Bespoke-Nimble-9B must be loaded as base model plus LoRA adapter. See scripts/serve_typed_model.py.",
    );
  }
  return new HttpInferenceBackend(config.endpoint, config.timeoutMs ?? 8000, protocol, config);
}

export function typedSpec(partial: Omit<TypedModelSpec, "capabilities" | "parameters"> & { capabilities?: Partial<ModelCapabilities>; parameters?: readonly string[] }): TypedModelSpec {
  return {
    ...partial,
    capabilities: { ...TYPED_CAPABILITIES, ...partial.capabilities },
    parameters: partial.parameters ?? LOCAL_PARAMS,
  };
}

export const AGENT_JEV_SPEC = typedSpec({
  id: "agent-jev",
  name: "AgentJev",
  version: "AgentJev-0.6B",
  type: "typed-decision",
  provider: "huggingface:aimeigaoshou/agent-jev",
  protocol: "agentjev",
});

export const NIMBLE_SPEC = typedSpec({
  id: "nimble",
  name: "Nimble",
  version: "nimble",
  type: "typed-decision",
  provider: "github:bespokelabsai/nimble",
  protocol: "nimble",
});

export const NIMBLE_9B_SPEC = typedSpec({
  id: "nimble-9b",
  name: "Bespoke-Nimble-9B",
  version: "Bespoke-Nimble-9B",
  type: "typed-decision-lora",
  provider: "huggingface:bespokelabs/Bespoke-Nimble-9B",
  protocol: "nimble",
  capabilities: { requiresBaseModel: true },
});

export const DECIDER_SPEC = typedSpec({
  id: "decider-2b",
  name: "Decider",
  version: "decider-2b",
  type: "typed-decision",
  provider: "huggingface:Mapika/decider-2b",
  protocol: "agentjev",
});

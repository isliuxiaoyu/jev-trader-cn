import { DecisionError, type DecisionResponse, type DecisionSchema, type TypedAnswer } from "./types";
import type { AStockTradeState } from "../market/types";

export type TradeAction = "BUY" | "HOLD" | "SELL";

export interface PolicyDecision {
  policyId: string;
  policyVersion: string;
  action: TradeAction;
  reasons: string[];
}

export interface PolicyInput {
  response: DecisionResponse;
  peers: DecisionResponse[];
  state: AStockTradeState;
  schema: DecisionSchema;
}

export interface DecisionPolicy {
  readonly id: string;
  readonly version: string;
  interpret(input: PolicyInput): PolicyDecision;
}

export interface ThresholdConfig {
  threshold: number;
  minMargin: number;
}

const DEFAULTS: ThresholdConfig = { threshold: 0.55, minMargin: 0.05 };

export class ThresholdPolicy implements DecisionPolicy {
  readonly id = "threshold-v1";
  readonly version = "v1";
  constructor(private readonly cfg: ThresholdConfig = DEFAULTS) {}

  interpret(input: PolicyInput): PolicyDecision {
    const reasons: string[] = [];
    if (!tradeable(input, reasons)) return hold(this, reasons);
    const actionAnswer = findChoice(input.response, "trade_action");
    if (actionAnswer) return this.fromTradeAction(actionAnswer, input, reasons);
    const direction = directional(input.response);
    if (!direction) return hold(this, ["schema has no direction or trade_action question"]);
    const upEdge = direction.up - Math.max(direction.down, direction.flat);
    const downEdge = direction.down - Math.max(direction.up, direction.flat);
    if (direction.up >= this.cfg.threshold && upEdge >= this.cfg.minMargin && input.state.canBuy) {
      reasons.push(`up mass ${direction.up.toFixed(3)} clears threshold`);
      return { policyId: this.id, policyVersion: this.version, action: "BUY", reasons };
    }
    if (direction.down >= this.cfg.threshold && downEdge >= this.cfg.minMargin && input.state.canSell) {
      reasons.push(`down mass ${direction.down.toFixed(3)} clears threshold`);
      return { policyId: this.id, policyVersion: this.version, action: "SELL", reasons };
    }
    reasons.push("direction mass or margin below threshold");
    return hold(this, reasons);
  }

  private fromTradeAction(answer: TypedAnswer, input: PolicyInput, reasons: string[]): PolicyDecision {
    if (answer.type !== "choice") return hold(this, reasons);
    const p = answer.probabilities;
    const buy = p.BUY ?? 0;
    const sell = p.SELL ?? 0;
    const holdP = p.HOLD ?? 0;
    if (buy >= this.cfg.threshold && buy - Math.max(sell, holdP) >= this.cfg.minMargin && input.state.canBuy) {
      reasons.push("BUY mass clears threshold");
      return { policyId: this.id, policyVersion: this.version, action: "BUY", reasons };
    }
    if (sell >= this.cfg.threshold && sell - Math.max(buy, holdP) >= this.cfg.minMargin && input.state.canSell) {
      reasons.push("SELL mass clears threshold");
      return { policyId: this.id, policyVersion: this.version, action: "SELL", reasons };
    }
    reasons.push("trade action mass below threshold");
    return hold(this, reasons);
  }
}

export class MomentumPolicy implements DecisionPolicy {
  readonly id = "momentum-v1";
  readonly version = "v1";
  constructor(private readonly inner = new ThresholdPolicy()) {}

  interpret(input: PolicyInput): PolicyDecision {
    const base = this.inner.interpret(input);
    const ret = input.state.return5m;
    if (base.action === "BUY" && ret <= 0) {
      return { policyId: this.id, policyVersion: this.version, action: "HOLD", reasons: ["model UP disagrees with non-positive 5m return"] };
    }
    if (base.action === "SELL" && ret >= 0) {
      return { policyId: this.id, policyVersion: this.version, action: "HOLD", reasons: ["model DOWN disagrees with non-negative 5m return"] };
    }
    return { policyId: this.id, policyVersion: this.version, action: base.action, reasons: base.reasons };
  }
}

export class ProbabilityEdgePolicy implements DecisionPolicy {
  readonly id = "probability-edge-v1";
  readonly version = "v1";
  constructor(private readonly edge = 0.15) {}

  interpret(input: PolicyInput): PolicyDecision {
    const reasons: string[] = [];
    if (!tradeable(input, reasons)) return { policyId: this.id, policyVersion: this.version, action: "HOLD", reasons };
    const direction = directional(input.response);
    if (!direction) return { policyId: this.id, policyVersion: this.version, action: "HOLD", reasons: ["no direction question"] };
    const gap = direction.up - direction.down;
    if (gap >= this.edge && input.state.canBuy) {
      return { policyId: this.id, policyVersion: this.version, action: "BUY", reasons: [`up-down edge ${gap.toFixed(3)}`] };
    }
    if (-gap >= this.edge && input.state.canSell) {
      return { policyId: this.id, policyVersion: this.version, action: "SELL", reasons: [`down-up edge ${(-gap).toFixed(3)}`] };
    }
    return { policyId: this.id, policyVersion: this.version, action: "HOLD", reasons: ["edge below threshold"] };
  }
}

export class ConsensusPolicy implements DecisionPolicy {
  readonly id = "consensus-v1";
  readonly version = "v1";
  constructor(private readonly inner = new ThresholdPolicy()) {}

  interpret(input: PolicyInput): PolicyDecision {
    const votes = [input.response, ...input.peers].map((r) => directional(r)?.winner ?? "FLAT");
    const count = { UP: 0, DOWN: 0, FLAT: 0 };
    for (const v of votes) count[v] += 1;
    const ranked = (Object.entries(count) as Array<["UP" | "DOWN" | "FLAT", number]>).sort((a, b) => b[1] - a[1]);
    const [winner, n] = ranked[0] ?? ["FLAT", 0];
    const second = ranked[1]?.[1] ?? 0;
    if (n === second) return { policyId: this.id, policyVersion: this.version, action: "HOLD", reasons: ["direction votes tied"] };
    const gated = this.inner.interpret(input);
    if (winner === "UP" && gated.action !== "SELL" && input.state.canBuy && n > second) {
      return { policyId: this.id, policyVersion: this.version, action: "BUY", reasons: [`${n} models lean UP`] };
    }
    if (winner === "DOWN" && gated.action !== "BUY" && input.state.canSell) {
      return { policyId: this.id, policyVersion: this.version, action: "SELL", reasons: [`${n} models lean DOWN`] };
    }
    return { policyId: this.id, policyVersion: this.version, action: "HOLD", reasons: ["consensus does not clear the primary gate"] };
  }
}

const POLICIES: Record<string, () => DecisionPolicy> = {
  "threshold-v1": () => new ThresholdPolicy(),
  "momentum-v1": () => new MomentumPolicy(),
  "probability-edge-v1": () => new ProbabilityEdgePolicy(),
  "consensus-v1": () => new ConsensusPolicy(),
};

export function createPolicy(id: string): DecisionPolicy {
  const factory = POLICIES[id];
  if (!factory) throw new DecisionError(`unknown decision policy ${id}`);
  return factory();
}

export function listPolicies(): string[] {
  return Object.keys(POLICIES);
}

function hold(policy: DecisionPolicy, reasons: string[]): PolicyDecision {
  return { policyId: policy.id, policyVersion: policy.version, action: "HOLD", reasons };
}

function tradeable(input: PolicyInput, reasons: string[]): boolean {
  const flag = input.response.answers.find((a) => a.questionId === "tradeability");
  if (flag && flag.type === "boolean" && (flag.selectedValue === "NO" || flag.probabilities.YES < 0.5)) {
    reasons.push("tradeability is NO");
    return false;
  }
  return true;
}

function findChoice(response: DecisionResponse, id: string): TypedAnswer | undefined {
  return response.answers.find((a) => a.questionId === id);
}

interface DirectionMass {
  up: number;
  down: number;
  flat: number;
  winner: "UP" | "DOWN" | "FLAT";
}

export function directional(response: DecisionResponse): DirectionMass | null {
  const answer = response.answers.find((a) => a.type === "choice" && (a.questionId.startsWith("direction") || a.options.includes("UP") || a.options.includes("STRONG_UP")));
  if (!answer || answer.type !== "choice") return null;
  const p = answer.probabilities;
  const up = (p.UP ?? 0) + (p.STRONG_UP ?? 0);
  const down = (p.DOWN ?? 0) + (p.STRONG_DOWN ?? 0);
  const flat = p.FLAT ?? 0;
  const winner = up >= down && up >= flat ? "UP" : down >= up && down >= flat ? "DOWN" : "FLAT";
  return { up, down, flat, winner };
}

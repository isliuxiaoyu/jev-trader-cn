import { DecisionError } from "../decision/types";
import { roundPx } from "../market/clock";

export interface TradingRuleProfile {
  id: string;
  lotSize: number;
  minQty: number;
  limitPct: number;
  commissionRate: number;
  minCommission: number;
  /** Sell-side stamp duty. */
  stampDutyRate: number;
  transferFeeRate: number;
  slippageBps: number;
  defaultQty: number;
  /** Return band that labels a future move FLAT. */
  flatBand: number;
}

const fees = {
  commissionRate: 0.00025,
  minCommission: 5,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 1,
  defaultQty: 100,
  flatBand: 0.001,
};

export const PROFILES: Record<string, TradingRuleProfile> = {
  "AStock-MainBoard-v1": { id: "AStock-MainBoard-v1", lotSize: 100, minQty: 100, limitPct: 0.1, ...fees },
  "AStock-ChiNext-v1": { id: "AStock-ChiNext-v1", lotSize: 100, minQty: 100, limitPct: 0.2, ...fees },
  "AStock-STAR-v1": { id: "AStock-STAR-v1", lotSize: 1, minQty: 200, limitPct: 0.2, ...fees },
  "AStock-ST-v1": { id: "AStock-ST-v1", lotSize: 100, minQty: 100, limitPct: 0.05, ...fees },
};

export function getProfile(id: string): TradingRuleProfile {
  const profile = PROFILES[id];
  if (!profile) throw new DecisionError(`unknown trading rule profile ${id}`);
  return profile;
}

export function limitPrices(prevClose: number, limitPct: number): { up: number; down: number } {
  return { up: roundPx(prevClose * (1 + limitPct)), down: roundPx(prevClose * (1 - limitPct)) };
}

export function tradeFee(profile: TradingRuleProfile, side: "BUY" | "SELL", notional: number): number {
  const commission = Math.max(notional * profile.commissionRate, notional > 0 ? profile.minCommission : 0);
  const stamp = side === "SELL" ? notional * profile.stampDutyRate : 0;
  const transfer = notional * profile.transferFeeRate;
  return commission + stamp + transfer;
}

import { inContinuousSession, shanghaiParts } from "../market/clock";
import type { AStockTradeState } from "../market/types";
import { getProfile, tradeFee, type TradingRuleProfile } from "./profile";

export interface OrderIntent {
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  timestamp: number;
}

export interface RuleCheck {
  ok: boolean;
  reasons: string[];
}

export interface AccountView {
  cash: number;
  availableCash: number;
  position: number;
  availablePosition: number;
  todayBought: number;
  averageCost: number | null;
}

export class AStockTradingRules {
  readonly profile: TradingRuleProfile;

  constructor(profile: TradingRuleProfile) {
    this.profile = profile;
  }

  static fromId(id: string): AStockTradingRules {
    return new AStockTradingRules(getProfile(id));
  }

  fee(side: "BUY" | "SELL", notional: number): number {
    return tradeFee(this.profile, side, notional);
  }

  check(intent: OrderIntent, state: AStockTradeState, account: AccountView): RuleCheck {
    const reasons: string[] = [];
    if (intent.symbol !== state.symbol) reasons.push("symbol mismatch");
    if (!inContinuousSession(intent.timestamp)) reasons.push("outside continuous auction");
    if (state.suspended) reasons.push("suspended");
    if (intent.side === "BUY" && state.limitUp) reasons.push("limit up");
    if (intent.side === "SELL" && state.limitDown) reasons.push("limit down");
    if (!(intent.qty > 0)) reasons.push("quantity must be positive");
    if (intent.qty < this.profile.minQty) reasons.push(`below minimum quantity ${this.profile.minQty}`);
    if (this.profile.lotSize > 1 && intent.qty % this.profile.lotSize !== 0) reasons.push(`quantity must be a multiple of ${this.profile.lotSize}`);
    if (intent.side === "SELL" && intent.qty > account.availablePosition) reasons.push("T+1 or position blocks the sell");
    if (intent.side === "BUY") {
      const px = state.ask1 > 0 ? state.ask1 : state.price;
      const notional = px * intent.qty;
      const cost = notional + this.fee("BUY", notional);
      if (cost > account.availableCash) reasons.push("insufficient cash");
    }
    return { ok: reasons.length === 0, reasons };
  }
}

export function sameTradingDay(a: number, b: number): boolean {
  return shanghaiParts(a).dateKey === shanghaiParts(b).dateKey;
}

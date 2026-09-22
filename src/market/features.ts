import { DecisionError, type NormalizedState } from "../decision/types";
import type { TradingRuleProfile } from "../rules/profile";
import { limitPrices } from "../rules/profile";
import { inContinuousSession } from "./clock";
import { EMPTY_ACCOUNT, type AccountSnapshot, type AStockTradeState, type RawQuote, type RawTrade } from "./types";

export const FEATURE_VERSION = "v1";

const MINUTE = 60_000;

export interface FeatureInput {
  symbol: string;
  asOf: number;
  quotes: RawQuote[];
  account?: AccountSnapshot;
  profile: TradingRuleProfile;
}

export class AStockFeatureEngine {
  readonly version = FEATURE_VERSION;

  build(input: FeatureInput): AStockTradeState {
    const quotes = input.quotes.filter((q) => q.symbol === input.symbol).slice().sort((a, b) => a.timestamp - b.timestamp);
    for (const q of quotes) {
      if (q.timestamp > input.asOf) {
        throw new DecisionError(`lookahead: quote ${q.timestamp} is after decision timestamp ${input.asOf}`);
      }
    }
    const last = lastAtOrBefore(quotes, input.asOf);
    if (!last) throw new DecisionError(`no quote at or before ${input.asOf} for ${input.symbol}`);
    const account = input.account ?? EMPTY_ACCOUNT;
    const limits = limitPrices(last.prevClose, input.profile.limitPct);
    const bid = pad(last.bids);
    const ask = pad(last.asks);
    const bidVol = pad(last.bidVolumes);
    const askVol = pad(last.askVolumes);
    const bidDepth = sum(bidVol);
    const askDepth = sum(askVol);
    const mid = last.price > 0 ? last.price : (bid[0]! + ask[0]!) / 2;
    const spread = ask[0]! > 0 && bid[0]! > 0 ? ask[0]! - bid[0]! : 0;
    const denom = bidDepth + askDepth;
    const bookImbalance = denom > 0 ? (bidDepth - askDepth) / denom : 0;
    const ret = (windowMs: number) => simpleReturn(quotes, input.asOf, windowMs);
    const return5m = ret(5 * MINUTE);
    const indexReturn = relativeReturn(quotes, input.asOf, 5 * MINUTE, "indexPrice");
    const sectorReturn = relativeReturn(quotes, input.asOf, 5 * MINUTE, "sectorPrice");
    const trades = tradesSince(quotes, input.asOf - MINUTE, input.asOf);
    const buyVol = trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.volume, 0);
    const sellVol = trades.filter((t) => t.side === "sell").reduce((s, t) => s + t.volume, 0);
    const traded = buyVol + sellVol;
    const volNow = last.volume;
    const amtNow = last.amount;
    const prev1m = lastAtOrBefore(quotes, input.asOf - MINUTE);
    const limitUp = last.price >= limits.up - 1e-9;
    const limitDown = last.price <= limits.down + 1e-9;
    const suspended = last.suspended === true;
    const session = inContinuousSession(input.asOf);
    const canBuy = session && !suspended && !limitUp && account.availableCash > 0;
    const canSell = session && !suspended && !limitDown && account.availablePosition >= input.profile.minQty;
    return {
      symbol: input.symbol,
      timestamp: input.asOf,
      featureVersion: FEATURE_VERSION,
      price: last.price,
      open: last.open,
      high: last.high,
      low: last.low,
      prevClose: last.prevClose,
      volume: volNow,
      amount: amtNow,
      bid1: bid[0]!, bid2: bid[1]!, bid3: bid[2]!, bid4: bid[3]!, bid5: bid[4]!,
      ask1: ask[0]!, ask2: ask[1]!, ask3: ask[2]!, ask4: ask[3]!, ask5: ask[4]!,
      bidVolume1: bidVol[0]!, bidVolume2: bidVol[1]!, bidVolume3: bidVol[2]!, bidVolume4: bidVol[3]!, bidVolume5: bidVol[4]!,
      askVolume1: askVol[0]!, askVolume2: askVol[1]!, askVolume3: askVol[2]!, askVolume4: askVol[3]!, askVolume5: askVol[4]!,
      spread,
      spreadBps: mid > 0 ? (spread / mid) * 10_000 : 0,
      bookImbalance,
      bidDepth,
      askDepth,
      returnTick: tickReturn(quotes, input.asOf),
      return1m: ret(MINUTE),
      return5m,
      return15m: ret(15 * MINUTE),
      return30m: ret(30 * MINUTE),
      volatility: volatility(quotes, input.asOf),
      rollingVolume: Math.max(0, volNow - (prev1m?.volume ?? volNow)),
      rollingAmount: Math.max(0, amtNow - (prev1m?.amount ?? amtNow)),
      volumeChange: volNow - (prev1m?.volume ?? volNow),
      amountChange: amtNow - (prev1m?.amount ?? amtNow),
      recentTrades: trades.slice(-20),
      activeBuyRatio: traded > 0 ? buyVol / traded : 0,
      activeSellRatio: traded > 0 ? sellVol / traded : 0,
      indexReturn,
      sectorReturn,
      relStrengthIndex: indexReturn == null ? null : return5m - indexReturn,
      relStrengthSector: sectorReturn == null ? null : return5m - sectorReturn,
      marketBreadth: last.breadth ?? null,
      position: account.position,
      availablePosition: account.availablePosition,
      availableCash: account.availableCash,
      averageCost: account.averageCost,
      canBuy,
      canSell,
      limitUp,
      limitDown,
      suspended,
      limitUpPrice: limits.up,
      limitDownPrice: limits.down,
    };
  }
}

export function toNormalizedState(state: AStockTradeState): NormalizedState {
  const features: Record<string, number | string | boolean | null> = {
    price: state.price,
    spread: state.spread,
    spreadBps: state.spreadBps,
    bookImbalance: state.bookImbalance,
    bidDepth: state.bidDepth,
    askDepth: state.askDepth,
    returnTick: state.returnTick,
    return1m: state.return1m,
    return5m: state.return5m,
    return15m: state.return15m,
    return30m: state.return30m,
    volatility: state.volatility,
    volumeChange: state.volumeChange,
    amountChange: state.amountChange,
    activeBuyRatio: state.activeBuyRatio,
    activeSellRatio: state.activeSellRatio,
    indexReturn: state.indexReturn,
    sectorReturn: state.sectorReturn,
    relStrengthIndex: state.relStrengthIndex,
    relStrengthSector: state.relStrengthSector,
    marketBreadth: state.marketBreadth,
    canBuy: state.canBuy,
    canSell: state.canSell,
    limitUp: state.limitUp,
    limitDown: state.limitDown,
    suspended: state.suspended,
    position: state.position,
    availablePosition: state.availablePosition,
    availableCash: state.availableCash,
  };
  return {
    symbol: state.symbol,
    timestamp: state.timestamp,
    featureVersion: state.featureVersion,
    features,
    text: stableJson({ symbol: state.symbol, timestamp: state.timestamp, featureVersion: state.featureVersion, features }),
  };
}

export function assertNoLookahead(timestamps: readonly number[], asOf: number): void {
  for (const ts of timestamps) {
    if (ts > asOf) throw new DecisionError(`lookahead: input ${ts} is after ${asOf}`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
    return out;
  }
  return value;
}

function pad(xs: number[]): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const v = xs[i];
    out[i] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  return out;
}

function sum(xs: number[]): number {
  return xs.reduce((s, n) => s + n, 0);
}

function lastAtOrBefore(quotes: RawQuote[], t: number): RawQuote | undefined {
  let found: RawQuote | undefined;
  for (const q of quotes) {
    if (q.timestamp > t) break;
    found = q;
  }
  return found;
}

function simpleReturn(quotes: RawQuote[], asOf: number, windowMs: number): number {
  const now = lastAtOrBefore(quotes, asOf);
  const then = lastAtOrBefore(quotes, asOf - windowMs);
  if (!now || !then || then.timestamp === now.timestamp || then.price === 0) return 0;
  return now.price / then.price - 1;
}

function tickReturn(quotes: RawQuote[], asOf: number): number {
  const now = lastAtOrBefore(quotes, asOf);
  if (!now) return 0;
  let prev: RawQuote | undefined;
  for (const q of quotes) {
    if (q.timestamp >= now.timestamp) break;
    prev = q;
  }
  if (!prev || prev.price === 0) return 0;
  return now.price / prev.price - 1;
}

function relativeReturn(quotes: RawQuote[], asOf: number, windowMs: number, field: "indexPrice" | "sectorPrice"): number | null {
  const now = lastAtOrBefore(quotes, asOf);
  const then = lastAtOrBefore(quotes, asOf - windowMs);
  const a = now?.[field];
  const b = then?.[field];
  if (a == null || b == null || b === 0 || !then || !now || then.timestamp === now.timestamp) return null;
  return a / b - 1;
}

function volatility(quotes: RawQuote[], asOf: number): number {
  const window = quotes.filter((q) => q.timestamp <= asOf && q.timestamp >= asOf - 30 * MINUTE);
  if (window.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!;
    const cur = window[i]!;
    if (prev.price > 0) rets.push(cur.price / prev.price - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, n) => s + n, 0) / rets.length;
  const variance = rets.reduce((s, n) => s + (n - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

function tradesSince(quotes: RawQuote[], fromExclusive: number, asOf: number): RawTrade[] {
  const out: RawTrade[] = [];
  for (const q of quotes) {
    if (q.timestamp > asOf) break;
    for (const t of q.trades ?? []) {
      if (t.timestamp > fromExclusive && t.timestamp <= asOf) out.push(t);
    }
  }
  return out;
}

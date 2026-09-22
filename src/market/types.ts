export interface RawTrade {
  timestamp: number;
  price: number;
  volume: number;
  side: "buy" | "sell" | "unknown";
}

/** Provider-neutral quote. Timestamps are unix milliseconds. */
export interface RawQuote {
  symbol: string;
  timestamp: number;
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  /** Session-cumulative volume. */
  volume: number;
  /** Session-cumulative amount. */
  amount: number;
  bids: number[];
  asks: number[];
  bidVolumes: number[];
  askVolumes: number[];
  trades?: RawTrade[];
  indexPrice?: number;
  sectorPrice?: number;
  /** Advance ratio in [-1, 1], when the provider has it. */
  breadth?: number;
  suspended?: boolean;
}

export interface MarketDataProvider {
  readonly id: string;
  /** Quotes with timestamp <= asOf only. Future rows must not be returned. */
  history(symbol: string, asOf: number): RawQuote[];
}

export interface AStockTradeState {
  symbol: string;
  timestamp: number;
  featureVersion: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  amount: number;
  bid1: number;
  bid2: number;
  bid3: number;
  bid4: number;
  bid5: number;
  ask1: number;
  ask2: number;
  ask3: number;
  ask4: number;
  ask5: number;
  bidVolume1: number;
  bidVolume2: number;
  bidVolume3: number;
  bidVolume4: number;
  bidVolume5: number;
  askVolume1: number;
  askVolume2: number;
  askVolume3: number;
  askVolume4: number;
  askVolume5: number;
  spread: number;
  spreadBps: number;
  bookImbalance: number;
  bidDepth: number;
  askDepth: number;
  returnTick: number;
  return1m: number;
  return5m: number;
  return15m: number;
  return30m: number;
  volatility: number;
  rollingVolume: number;
  rollingAmount: number;
  volumeChange: number;
  amountChange: number;
  recentTrades: RawTrade[];
  activeBuyRatio: number;
  activeSellRatio: number;
  indexReturn: number | null;
  sectorReturn: number | null;
  relStrengthIndex: number | null;
  relStrengthSector: number | null;
  marketBreadth: number | null;
  position: number;
  availablePosition: number;
  availableCash: number;
  averageCost: number | null;
  canBuy: boolean;
  canSell: boolean;
  limitUp: boolean;
  limitDown: boolean;
  suspended: boolean;
  limitUpPrice: number;
  limitDownPrice: number;
}

export interface AccountSnapshot {
  position: number;
  availablePosition: number;
  availableCash: number;
  averageCost: number | null;
}

export const EMPTY_ACCOUNT: AccountSnapshot = {
  position: 0,
  availablePosition: 0,
  availableCash: 0,
  averageCost: null,
};

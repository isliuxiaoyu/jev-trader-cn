import { shanghaiTs } from "./clock";
import type { RawQuote } from "./types";

/** Deterministic intraday tape for replay, tests, and the local dashboard. */
export function buildSampleTape(opts?: { symbol?: string; startPrice?: number; prevClose?: number }): RawQuote[] {
  const symbol = opts?.symbol ?? "600519.SH";
  const prevClose = opts?.prevClose ?? 1400;
  const start = shanghaiTs(2026, 9, 22, 9, 30, 0);
  const quotes: RawQuote[] = [];
  let price = opts?.startPrice ?? prevClose;
  let volume = 0;
  let amount = 0;
  let indexPx = 3800;
  let sectorPx = 1200;
  for (let i = 0; i <= 360; i++) {
    const timestamp = start + i * 10_000;
    const drift = Math.sin(i / 18) * 0.4 + i * 0.01;
    price = Math.round((prevClose + drift) * 100) / 100;
    indexPx = Math.round((3800 + i * 0.002) * 100) / 100;
    sectorPx = Math.round((1200 + Math.sin(i / 30) * 0.2) * 100) / 100;
    const spread = 0.01;
    const bid1 = Math.round((price - spread / 2) * 100) / 100;
    const ask1 = Math.round((price + spread / 2) * 100) / 100;
    const stepVol = 100 + (i % 7) * 20;
    volume += stepVol;
    amount += price * stepVol;
    const prev = i === 0 ? prevClose : quotes[i - 1]!.price;
    const side = price >= prev ? "buy" : "sell";
    quotes.push({
      symbol,
      timestamp,
      price,
      open: prevClose,
      high: Math.max(prevClose, price),
      low: Math.min(prevClose, price),
      prevClose,
      volume,
      amount,
      bids: [bid1, bid1 - 0.01, bid1 - 0.02, bid1 - 0.03, bid1 - 0.04],
      asks: [ask1, ask1 + 0.01, ask1 + 0.02, ask1 + 0.03, ask1 + 0.04],
      bidVolumes: [500, 400, 300, 200, 100],
      askVolumes: [80, 400, 300, 200, 100],
      trades: [{ timestamp, price, volume: stepVol, side }],
      indexPrice: indexPx,
      sectorPrice: sectorPx,
      breadth: 0.1,
      suspended: false,
    });
  }
  return quotes;
}

/** Two prints one second apart, plus a unique future price, for the lookahead test. */
export function lookaheadFixture(): { asOf: number; future: number; quotes: RawQuote[] } {
  const asOf = shanghaiTs(2026, 9, 22, 10, 0, 10);
  const future = asOf + 1000;
  const base = {
    symbol: "600000.SH",
    open: 10,
    high: 10,
    low: 10,
    prevClose: 10,
    volume: 1000,
    amount: 10000,
    bids: [9.99, 9.98, 9.97, 9.96, 9.95],
    asks: [10.01, 10.02, 10.03, 10.04, 10.05],
    bidVolumes: [300, 100, 100, 100, 100],
    askVolumes: [100, 100, 100, 100, 100],
    suspended: false,
  };
  return {
    asOf,
    future,
    quotes: [
      { ...base, timestamp: asOf, price: 10, trades: [{ timestamp: asOf, price: 10, volume: 100, side: "buy" }] },
      { ...base, timestamp: future, price: 9999, volume: 5000, amount: 99990000, trades: [{ timestamp: future, price: 9999, volume: 100, side: "buy" }] },
    ],
  };
}

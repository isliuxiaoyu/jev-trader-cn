import { expect, test } from "bun:test";
import { AStockFeatureEngine, toNormalizedState } from "./features";
import { shanghaiTs } from "./clock";
import { CsvMarketDataProvider, IFindMarketDataProvider, MockMarketDataProvider, parseIFindRealtime } from "./providers";
import { lookaheadFixture } from "./tape";
import { getProfile } from "../rules/profile";
import type { RawQuote } from "./types";

const profile = getProfile("AStock-MainBoard-v1");

test("book imbalance, depth, and short-horizon returns use only past quotes", () => {
  const t0 = shanghaiTs(2026, 9, 22, 10, 0, 0);
  const quotes = [
    quote(t0, 10, 100),
    quote(t0 + 60_000, 10.1, 250),
  ];
  quotes[1]!.bidVolumes = [300, 0, 0, 0, 0];
  quotes[1]!.askVolumes = [100, 0, 0, 0, 0];
  const state = new AStockFeatureEngine().build({ symbol: "600000.SH", asOf: t0 + 60_000, quotes, profile, account: { position: 0, availablePosition: 0, availableCash: 1000, averageCost: null } });
  expect(state.bookImbalance).toBeCloseTo(0.5);
  expect(state.bidDepth).toBe(300);
  expect(state.askDepth).toBe(100);
  expect(state.return1m).toBeCloseTo(0.01);
  expect(state.volumeChange).toBe(150);
});

test("10:00:10 input never contains the 10:00:11 print", () => {
  const fx = lookaheadFixture();
  const provider = new MockMarketDataProvider(fx.quotes);
  const visible = provider.history("600000.SH", fx.asOf);
  expect(visible.map((q) => q.timestamp)).toEqual([fx.asOf]);
  expect(() => new AStockFeatureEngine().build({ symbol: "600000.SH", asOf: fx.asOf, quotes: fx.quotes, profile })).toThrow(/lookahead/);
  const state = new AStockFeatureEngine().build({ symbol: "600000.SH", asOf: fx.asOf, quotes: visible, profile, account: { position: 0, availablePosition: 0, availableCash: 1000, averageCost: null } });
  const request = JSON.stringify(toNormalizedState(state));
  expect(request.includes("99990000")).toBe(false);
  expect(state.price).toBe(10);
  expect(state.volume).toBe(1000);
});

test("csv provider hides rows after the decision timestamp", () => {
  const csv = [
    "symbol,timestamp,price,open,high,low,prevClose,volume,amount,bid1,ask1,bidVolume1,askVolume1",
    "600000.SH,1000,10,10,10,10,10,100,1000,9.99,10.01,10,10",
    "600000.SH,2000,11,10,11,10,10,200,2000,10.99,11.01,10,10",
  ].join("\n");
  const provider = new CsvMarketDataProvider(csv);
  expect(provider.history("600000.SH", 1000)).toHaveLength(1);
  expect(provider.history("600000.SH", 2000)).toHaveLength(2);
});

test("ifind adapter normalizes a quantapi table without the feature engine calling it", async () => {
  const body = {
    tables: [{
      thscode: "600000.SH",
      time: 1_700_000_000_000,
      table: { latest: [10.5], open: [10], high: [10.6], low: [9.9], preClose: [10], volume: [1000], amount: [10500], bid1: [10.49], ask1: [10.51], bidSize1: [200], askSize1: [80] },
    }],
  };
  const parsed = parseIFindRealtime(body, 0);
  expect(parsed[0]?.symbol).toBe("600000.SH");
  expect(parsed[0]?.price).toBe(10.5);
  expect(parsed[0]?.bidVolumes[0]).toBe(200);
  const provider = new IFindMarketDataProvider({
    endpoint: "https://quantapi.example",
    accessToken: "token",
    transport: {
      fetch: async () => new Response(JSON.stringify(body), { status: 200 }),
    },
  });
  await provider.poll(["600000.SH"], 1_700_000_000_000);
  expect(provider.history("600000.SH", 1_700_000_000_000)).toHaveLength(1);
  expect(provider.history("600000.SH", 0)).toHaveLength(0);
});

function quote(timestamp: number, price: number, volume: number): RawQuote {
  return {
    symbol: "600000.SH",
    timestamp,
    price,
    open: 10,
    high: price,
    low: price,
    prevClose: 10,
    volume,
    amount: price * volume,
    bids: [price - 0.01, 0, 0, 0, 0],
    asks: [price + 0.01, 0, 0, 0, 0],
    bidVolumes: [100, 0, 0, 0, 0],
    askVolumes: [100, 0, 0, 0, 0],
    trades: [{ timestamp, price, volume: 50, side: "buy" }],
  };
}

import { expect, test } from "bun:test";
import { BestAskPlusSlippage } from "./types";
import { PaperTrader } from "./paper";
import { AStockFeatureEngine } from "../market/features";
import { shanghaiTs } from "../market/clock";
import type { RawQuote } from "../market/types";
import { AStockTradingRules } from "../rules/astock";
import { tradeFee } from "../rules/profile";

test("rules cover session, limit up, suspension, lot size, cash, and T+1", () => {
  const rules = AStockTradingRules.fromId("AStock-MainBoard-v1");
  const session = shanghaiTs(2026, 9, 22, 10, 0, 0);
  const lunch = shanghaiTs(2026, 9, 22, 12, 0, 0);
  const engine = new AStockFeatureEngine();
  const base = quote(session, 10);
  const tradable = engine.build({ symbol: "600000.SH", asOf: session, quotes: [base], profile: rules.profile, account: { position: 0, availablePosition: 0, availableCash: 5000, averageCost: null } });
  expect(rules.check({ symbol: "600000.SH", side: "BUY", qty: 50, timestamp: session }, tradable, view(5000)).ok).toBe(false);
  expect(rules.check({ symbol: "600000.SH", side: "BUY", qty: 100, timestamp: lunch }, tradable, view(5000)).reasons).toContain("outside continuous auction");
  const sealed = engine.build({ symbol: "600000.SH", asOf: session, quotes: [quote(session, 11)], profile: rules.profile, account: { position: 0, availablePosition: 0, availableCash: 5000, averageCost: null } });
  expect(sealed.limitUp).toBe(true);
  expect(rules.check({ symbol: "600000.SH", side: "BUY", qty: 100, timestamp: session }, sealed, view(5000)).reasons).toContain("limit up");
  const halted = engine.build({ symbol: "600000.SH", asOf: session, quotes: [{ ...base, suspended: true }], profile: rules.profile, account: { position: 0, availablePosition: 0, availableCash: 5000, averageCost: null } });
  expect(rules.check({ symbol: "600000.SH", side: "BUY", qty: 100, timestamp: session }, halted, view(5000)).reasons).toContain("suspended");
  expect(rules.check({ symbol: "600000.SH", side: "BUY", qty: 100, timestamp: session }, tradable, view(10)).reasons).toContain("insufficient cash");
  expect(rules.check({ symbol: "600000.SH", side: "SELL", qty: 100, timestamp: session }, tradable, { ...view(5000), position: 100, availablePosition: 0, todayBought: 100 }).reasons).toContain("T+1 or position blocks the sell");
});

test("paper trader applies slippage, partial fills, fees, T+1, and pnl", () => {
  const rules = AStockTradingRules.fromId("AStock-MainBoard-v1");
  const execution = new BestAskPlusSlippage(10);
  const broker = new PaperTrader(rules, execution, 50_000);
  const session = shanghaiTs(2026, 9, 22, 10, 0, 0);
  const thin = new AStockFeatureEngine().build({
    symbol: "600000.SH",
    asOf: session,
    quotes: [{ ...quote(session, 10), asks: [10, 0, 0, 0, 0], askVolumes: [40, 0, 0, 0, 0] }],
    profile: rules.profile,
    account: broker.snapshot("600000.SH"),
  });
  expect(execution.quote("BUY", thin, 100).price).toBeCloseTo(10.01);
  const partial = broker.placeOrder({ symbol: "600000.SH", side: "BUY", qty: 100, timestamp: session, state: thin, type: "market" });
  expect(partial.status).toBe("partial");
  expect(partial.filledQty).toBe(40);
  expect(partial.fee).toBeCloseTo(tradeFee(rules.profile, "BUY", 10.01 * 40));
  broker.cancelOrder(partial.id);

  const fullBroker = new PaperTrader(rules, execution, 50_000);
  const openBook = new AStockFeatureEngine().build({
    symbol: "600000.SH",
    asOf: session,
    quotes: [{ ...quote(session, 10), asks: [10, 0, 0, 0, 0], askVolumes: [500, 0, 0, 0, 0] }],
    profile: rules.profile,
    account: fullBroker.snapshot("600000.SH"),
  });
  const bought = fullBroker.placeOrder({ symbol: "600000.SH", side: "BUY", qty: 100, timestamp: session, state: openBook, type: "market" });
  expect(bought.status).toBe("filled");
  const sameDay = fullBroker.placeOrder({ symbol: "600000.SH", side: "SELL", qty: 100, timestamp: session, state: openBook, type: "market" });
  expect(sameDay.status).toBe("rejected");
  const nextDay = shanghaiTs(2026, 9, 23, 10, 0, 0);
  const exit = new AStockFeatureEngine().build({
    symbol: "600000.SH",
    asOf: nextDay,
    quotes: [{ ...quote(nextDay, 10.5), prevClose: 10, bids: [10.5, 0, 0, 0, 0], bidVolumes: [500, 0, 0, 0, 0] }],
    profile: rules.profile,
    account: fullBroker.snapshot("600000.SH"),
  });
  const sold = fullBroker.placeOrder({ symbol: "600000.SH", side: "SELL", qty: 100, timestamp: nextDay, state: exit, type: "market" });
  expect(sold.status).toBe("filled");
  expect(sold.fee).toBeCloseTo(tradeFee(rules.profile, "SELL", sold.avgFillPrice * sold.filledQty));
  expect(fullBroker.getAccount().realized).toBeGreaterThan(0);
  expect(fullBroker.getPositions()[0]?.qty).toBe(0);
});

function view(cash: number) {
  return { cash, availableCash: cash, position: 0, availablePosition: 0, todayBought: 0, averageCost: null };
}

function quote(timestamp: number, price: number): RawQuote {
  return {
    symbol: "600000.SH",
    timestamp,
    price,
    open: 10,
    high: price,
    low: Math.min(10, price),
    prevClose: 10,
    volume: 1000,
    amount: 10000,
    bids: [price - 0.01, 0, 0, 0, 0],
    asks: [price + 0.01, 0, 0, 0, 0],
    bidVolumes: [500, 0, 0, 0, 0],
    askVolumes: [500, 0, 0, 0, 0],
  };
}

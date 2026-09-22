import { expect, test } from "bun:test";
import { assertCanRun } from "./capabilities";
import { normalizeProbabilities, topAndMargin } from "./normalizer";
import { createPolicy } from "./policy";
import { buildResponse } from "./response";
import { getSchema, validateSchema } from "./schema";
import { TYPED_CAPABILITIES } from "../models/typed";
import type { AStockTradeState } from "../market/types";
import type { DecisionResponse } from "./types";

test("normalizes candidate probabilities and keeps margin as top minus second", () => {
  const options = ["BUY", "HOLD", "SELL"];
  const probabilities = normalizeProbabilities({ BUY: 72, HOLD: 21, SELL: 7 }, options);
  expect(probabilities.BUY).toBeCloseTo(0.72);
  expect(probabilities.HOLD).toBeCloseTo(0.21);
  expect(probabilities.SELL).toBeCloseTo(0.07);
  const top = topAndMargin(probabilities, options);
  expect(top.selected).toBe("BUY");
  expect(top.topProbability).toBeCloseTo(0.72);
  expect(top.margin).toBeCloseTo(0.51);
});

test("schema validation rejects an empty option set", () => {
  expect(() => validateSchema({ id: "bad", version: "v1", requiresDistribution: true, questions: [{ id: "q", type: "choice", prompt: "x", options: [{ id: "A", description: "a" }] }] })).toThrow();
  expect(getSchema("direction_5m_v1").questions.map((q) => q.id)).toEqual(["direction_5m", "tradeability"]);
});

test("capability check fails before inference when score is unsupported", () => {
  expect(() => assertCanRun(
    { id: "narrow", capabilities: { ...TYPED_CAPABILITIES, supportsScore: false } },
    getSchema("volatility_5m_v1"),
  )).toThrow(/ADAPTER LIMITATION/);
});

test("threshold policy turns a direction distribution into BUY only after its own checks", () => {
  const policy = createPolicy("threshold-v1");
  const response = directionResponse({ UP: 0.8, FLAT: 0.12, DOWN: 0.08 });
  const buy = policy.interpret({ response, peers: [], state: state({ canBuy: true, canSell: true }), schema: getSchema("direction_5m_v1") });
  expect(buy.action).toBe("BUY");
  const blocked = policy.interpret({ response, peers: [], state: state({ canBuy: false, canSell: true, limitUp: true }), schema: getSchema("direction_5m_v1") });
  expect(blocked.action).toBe("HOLD");
});

function directionResponse(probabilities: Record<string, number>): DecisionResponse {
  return buildResponse(
    { id: "fixture", version: "v", capabilities: TYPED_CAPABILITIES },
    { state: { symbol: "600000.SH", timestamp: 1, featureVersion: "v1", features: {}, text: "{}" }, schema: getSchema("direction_5m_v1"), asOf: 1 },
    {
      answers: [
        { id: "direction_5m", distribution: probabilities },
        { id: "tradeability", distribution: { true: 0.9, false: 0.1 } },
      ],
    },
    3,
  );
}

function state(over: Partial<AStockTradeState>): AStockTradeState {
  return {
    symbol: "600000.SH",
    timestamp: 1,
    featureVersion: "v1",
    price: 10,
    open: 10,
    high: 10,
    low: 10,
    prevClose: 10,
    volume: 1,
    amount: 1,
    bid1: 9.99, bid2: 0, bid3: 0, bid4: 0, bid5: 0,
    ask1: 10.01, ask2: 0, ask3: 0, ask4: 0, ask5: 0,
    bidVolume1: 100, bidVolume2: 0, bidVolume3: 0, bidVolume4: 0, bidVolume5: 0,
    askVolume1: 100, askVolume2: 0, askVolume3: 0, askVolume4: 0, askVolume5: 0,
    spread: 0.02,
    spreadBps: 20,
    bookImbalance: 0,
    bidDepth: 100,
    askDepth: 100,
    returnTick: 0,
    return1m: 0,
    return5m: 0.01,
    return15m: 0,
    return30m: 0,
    volatility: 0,
    rollingVolume: 0,
    rollingAmount: 0,
    volumeChange: 0,
    amountChange: 0,
    recentTrades: [],
    activeBuyRatio: 0,
    activeSellRatio: 0,
    indexReturn: null,
    sectorReturn: null,
    relStrengthIndex: null,
    relStrengthSector: null,
    marketBreadth: null,
    position: 0,
    availablePosition: 0,
    availableCash: 100000,
    averageCost: null,
    canBuy: true,
    canSell: false,
    limitUp: false,
    limitDown: false,
    suspended: false,
    limitUpPrice: 11,
    limitDownPrice: 9,
    ...over,
  };
}

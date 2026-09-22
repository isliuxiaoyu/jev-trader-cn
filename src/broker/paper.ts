import { shanghaiParts } from "../market/clock";
import type { AStockTradeState } from "../market/types";
import type { AccountView, AStockTradingRules } from "../rules/astock";
import type { Account, BrokerAdapter, ExecutionModel, Fill, Order, PlaceOrderRequest, Position } from "./types";

interface Lot {
  symbol: string;
  qty: number;
  available: number;
  todayBought: number;
  cost: number;
  day: string;
  realized: number;
  fees: number;
  lastPrice: number;
}

export class PaperTrader implements BrokerAdapter {
  private cash: number;
  private orders: Order[] = [];
  private fills: Fill[] = [];
  private lots = new Map<string, Lot>();
  private seq = 0;

  constructor(
    private readonly rules: AStockTradingRules,
    private readonly execution: ExecutionModel,
    cash: number,
  ) {
    this.cash = cash;
  }

  placeOrder(req: PlaceOrderRequest): Order {
    this.roll(req.symbol, req.timestamp, req.state.price);
    const order: Order = {
      id: `paper-${++this.seq}`,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      limitPrice: req.limitPrice ?? null,
      status: "open",
      filledQty: 0,
      avgFillPrice: 0,
      fee: 0,
      createdAt: req.timestamp,
    };
    const check = this.rules.check(
      { symbol: req.symbol, side: req.side, qty: req.qty, timestamp: req.timestamp },
      req.state,
      this.accountView(req.symbol),
    );
    if (!check.ok) {
      order.status = "rejected";
      order.reason = check.reasons.join("; ");
      this.orders.push(order);
      return { ...order };
    }
    this.orders.push(order);
    this.fillAgainst(order, req.state);
    return { ...order };
  }

  cancelOrder(id: string): Order {
    const order = this.orders.find((o) => o.id === id);
    if (!order) throw new Error(`unknown order ${id}`);
    if (order.status === "open" || order.status === "partial") order.status = "canceled";
    return { ...order };
  }

  getOrders(): Order[] {
    return this.orders.map((o) => ({ ...o }));
  }

  getPositions(): Position[] {
    return [...this.lots.values()].map((lot) => ({
      symbol: lot.symbol,
      qty: lot.qty,
      available: lot.available,
      todayBought: lot.todayBought,
      averageCost: lot.qty > 0 ? lot.cost / lot.qty : null,
      realized: lot.realized,
      fees: lot.fees,
      lastPrice: lot.lastPrice,
    }));
  }

  getAccount(): Account {
    let market = 0;
    let realized = 0;
    let unrealized = 0;
    let fees = 0;
    for (const lot of this.lots.values()) {
      market += lot.qty * lot.lastPrice;
      realized += lot.realized;
      fees += lot.fees;
      if (lot.qty > 0) unrealized += lot.qty * lot.lastPrice - lot.cost;
    }
    return {
      cash: this.cash,
      equity: this.cash + market,
      availableCash: this.cash,
      realized,
      unrealized,
      fees,
    };
  }

  onMarketUpdate(state: AStockTradeState): Fill[] {
    this.roll(state.symbol, state.timestamp, state.price);
    const before = this.fills.length;
    for (const order of this.orders) {
      if (order.symbol !== state.symbol) continue;
      if (order.status !== "open" && order.status !== "partial") continue;
      this.fillAgainst(order, state);
    }
    return this.fills.slice(before).map((f) => ({ ...f }));
  }

  private fillAgainst(order: Order, state: AStockTradeState): void {
    const remaining = order.qty - order.filledQty;
    if (remaining <= 0) return;
    const quote = this.execution.quote(order.side, state, remaining);
    if (!(quote.maxQty > 0) || !(quote.price > 0)) return;
    if (order.limitPrice != null) {
      if (order.side === "BUY" && quote.price > order.limitPrice + 1e-9) return;
      if (order.side === "SELL" && quote.price < order.limitPrice - 1e-9) return;
    }
    let qty = Math.min(remaining, quote.maxQty);
    const feeProbe = this.rules.fee(order.side, quote.price * qty);
    if (order.side === "BUY") {
      const budget = this.accountView(order.symbol).availableCash;
      if (quote.price * qty + feeProbe > budget) {
        const unit = quote.price + this.rules.fee(order.side, quote.price);
        qty = Math.floor(budget / unit);
      }
      if (qty <= 0) return;
    } else if (qty > this.lot(order.symbol).available) {
      qty = this.lot(order.symbol).available;
      if (qty <= 0) return;
    }
    const notional = quote.price * qty;
    const fee = this.rules.fee(order.side, notional);
    const lot = this.lot(order.symbol);
    if (order.side === "BUY") {
      this.cash -= notional + fee;
      lot.cost += notional + fee;
      lot.qty += qty;
      lot.todayBought += qty;
    } else {
      const avg = lot.qty > 0 ? lot.cost / lot.qty : 0;
      this.cash += notional - fee;
      lot.realized += notional - fee - avg * qty;
      lot.cost -= avg * qty;
      lot.qty -= qty;
      lot.available -= qty;
      if (lot.qty <= 1e-9) {
        lot.qty = 0;
        lot.cost = 0;
        lot.available = 0;
      }
    }
    lot.fees += fee;
    lot.lastPrice = state.price;
    const prevNotional = order.avgFillPrice * order.filledQty;
    order.filledQty += qty;
    order.avgFillPrice = (prevNotional + notional) / order.filledQty;
    order.fee += fee;
    order.status = order.filledQty + 1e-9 >= order.qty ? "filled" : "partial";
    this.fills.push({
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      qty,
      price: quote.price,
      fee,
      timestamp: state.timestamp,
    });
  }

  private roll(symbol: string, timestamp: number, price: number): void {
    const lot = this.lot(symbol);
    const day = shanghaiParts(timestamp).dateKey;
    if (lot.day && lot.day !== day) {
      lot.available = lot.qty;
      lot.todayBought = 0;
    }
    lot.day = day;
    if (price > 0) lot.lastPrice = price;
  }

  private lot(symbol: string): Lot {
    let lot = this.lots.get(symbol);
    if (!lot) {
      lot = { symbol, qty: 0, available: 0, todayBought: 0, cost: 0, day: "", realized: 0, fees: 0, lastPrice: 0 };
      this.lots.set(symbol, lot);
    }
    return lot;
  }

  private accountView(symbol: string): AccountView {
    const lot = this.lot(symbol);
    return {
      cash: this.cash,
      availableCash: this.cash,
      position: lot.qty,
      availablePosition: lot.available,
      todayBought: lot.todayBought,
      averageCost: lot.qty > 0 ? lot.cost / lot.qty : null,
    };
  }

  snapshot(symbol: string): AccountView {
    return this.accountView(symbol);
  }
}

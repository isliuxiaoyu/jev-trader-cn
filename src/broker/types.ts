import type { AStockTradeState } from "../market/types";

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "open" | "partial" | "filled" | "canceled" | "rejected";

export interface PlaceOrderRequest {
  symbol: string;
  side: OrderSide;
  qty: number;
  timestamp: number;
  state: AStockTradeState;
  type?: "market" | "limit";
  limitPrice?: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  limitPrice: number | null;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number;
  fee: number;
  createdAt: number;
  reason?: string;
}

export interface Fill {
  orderId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  fee: number;
  timestamp: number;
}

export interface Position {
  symbol: string;
  qty: number;
  available: number;
  todayBought: number;
  averageCost: number | null;
  realized: number;
  fees: number;
  lastPrice: number;
}

export interface Account {
  cash: number;
  equity: number;
  availableCash: number;
  realized: number;
  unrealized: number;
  fees: number;
}

export interface BrokerAdapter {
  placeOrder(req: PlaceOrderRequest): Order;
  cancelOrder(id: string): Order;
  getOrders(): Order[];
  getPositions(): Position[];
  getAccount(): Account;
  onMarketUpdate(state: AStockTradeState): Fill[];
}

export interface ExecutionModel {
  readonly id: string;
  quote(side: OrderSide, state: AStockTradeState, qty: number): { price: number; maxQty: number };
}

export class BestAskPlusSlippage implements ExecutionModel {
  readonly id = "BestAskPlusSlippage";
  constructor(private readonly slippageBps: number) {}

  quote(side: OrderSide, state: AStockTradeState, qty: number): { price: number; maxQty: number } {
    const slip = this.slippageBps / 10_000;
    if (side === "BUY") {
      const touch = state.ask1 > 0 ? state.ask1 : state.price;
      return { price: touch * (1 + slip), maxQty: Math.min(qty, Math.max(0, state.askVolume1)) };
    }
    const touch = state.bid1 > 0 ? state.bid1 : state.price;
    return { price: touch * (1 - slip), maxQty: Math.min(qty, Math.max(0, state.bidVolume1)) };
  }
}

export function createExecution(id: string, slippageBps: number): ExecutionModel {
  if (id === "BestAskPlusSlippage") return new BestAskPlusSlippage(slippageBps);
  throw new Error(`unknown execution model ${id}`);
}

/** Live broker seam. Construction is refused so paper trading stays the default. */
export class QmtBrokerAdapter implements BrokerAdapter {
  constructor() {
    throw new Error("Real broker is disabled. QMT live trading is not available in this phase. Use PaperTrader.");
  }
  placeOrder(): Order { throw new Error("disabled"); }
  cancelOrder(): Order { throw new Error("disabled"); }
  getOrders(): Order[] { return []; }
  getPositions(): Position[] { return []; }
  getAccount(): Account { return { cash: 0, equity: 0, availableCash: 0, realized: 0, unrealized: 0, fees: 0 }; }
  onMarketUpdate(): Fill[] { return []; }
}

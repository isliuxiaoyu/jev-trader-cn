import { DecisionError } from "../decision/types";
import type { MarketDataProvider, RawQuote } from "./types";

export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = "mock";
  constructor(private readonly series: RawQuote[]) {}

  history(symbol: string, asOf: number): RawQuote[] {
    return this.series.filter((q) => q.symbol === symbol && q.timestamp <= asOf);
  }
}

export class CsvMarketDataProvider implements MarketDataProvider {
  readonly id = "csv";
  private readonly series: RawQuote[];

  constructor(csv: string) {
    this.series = parseQuoteCsv(csv);
  }

  history(symbol: string, asOf: number): RawQuote[] {
    return this.series.filter((q) => q.symbol === symbol && q.timestamp <= asOf);
  }
}

export function parseQuoteCsv(csv: string): RawQuote[] {
  const lines = csv.trim().split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0]?.split(",").map((s) => s.trim());
  if (!header || header.length < 8) throw new DecisionError("csv quote file is missing a header");
  const idx = (name: string) => header.indexOf(name);
  const need = ["symbol", "timestamp", "price", "open", "high", "low", "prevClose", "volume", "amount"];
  for (const name of need) if (idx(name) < 0) throw new DecisionError(`csv missing column ${name}`);
  const out: RawQuote[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const num = (name: string) => Number(cells[idx(name)]);
    const bids = [1, 2, 3, 4, 5].map((i) => numOr(cells, idx(`bid${i}`), 0));
    const asks = [1, 2, 3, 4, 5].map((i) => numOr(cells, idx(`ask${i}`), 0));
    const bidVolumes = [1, 2, 3, 4, 5].map((i) => numOr(cells, idx(`bidVolume${i}`), 0));
    const askVolumes = [1, 2, 3, 4, 5].map((i) => numOr(cells, idx(`askVolume${i}`), 0));
    out.push({
      symbol: cells[idx("symbol")] ?? "",
      timestamp: num("timestamp"),
      price: num("price"),
      open: num("open"),
      high: num("high"),
      low: num("low"),
      prevClose: num("prevClose"),
      volume: num("volume"),
      amount: num("amount"),
      bids,
      asks,
      bidVolumes,
      askVolumes,
      suspended: cells[idx("suspended")] === "true",
    });
  }
  return out;
}

function numOr(cells: string[], index: number, fallback: number): number {
  if (index < 0) return fallback;
  const n = Number(cells[index]);
  return Number.isFinite(n) ? n : fallback;
}

export interface IFindTransport {
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export interface IFindProviderOptions {
  endpoint: string;
  accessToken?: string;
  refreshToken?: string;
  transport?: IFindTransport;
  indicators?: string;
}

const DEFAULT_INDICATORS = [
  "latest", "open", "high", "low", "preClose", "volume", "amount",
  "bid1", "bid2", "bid3", "bid4", "bid5",
  "ask1", "ask2", "ask3", "ask4", "ask5",
  "bidSize1", "bidSize2", "bidSize3", "bidSize4", "bidSize5",
  "askSize1", "askSize2", "askSize3", "askSize4", "askSize5",
].join(",");

/**
 * iFinD HTTP adapter. Core code never calls this class directly;
 * bootstrap polls it, then the feature engine only sees RawQuote history.
 */
export class IFindMarketDataProvider implements MarketDataProvider {
  readonly id = "ifind";
  private cache: RawQuote[] = [];
  private accessToken: string | undefined;

  constructor(private readonly opts: IFindProviderOptions) {
    this.accessToken = opts.accessToken;
  }

  history(symbol: string, asOf: number): RawQuote[] {
    return this.cache.filter((q) => q.symbol === symbol && q.timestamp <= asOf);
  }

  async poll(symbols: string[], asOf: number): Promise<RawQuote[]> {
    if (!this.accessToken && this.opts.refreshToken) await this.refreshAccessToken();
    if (!this.accessToken) throw new DecisionError("iFinD access token is missing. Set IFIND_ACCESS_TOKEN.");
    const endpoint = this.opts.endpoint.replace(/\/$/, "");
    const transport = this.opts.transport ?? { fetch };
    const res = await transport.fetch(`${endpoint}/real_time_quotation`, {
      method: "POST",
      headers: { "content-type": "application/json", access_token: this.accessToken },
      body: JSON.stringify({ codes: symbols.join(","), indicators: this.opts.indicators ?? DEFAULT_INDICATORS }),
    });
    if (!res.ok) throw new DecisionError(`iFinD http ${res.status}`);
    const body = await res.json();
    const quotes = parseIFindRealtime(body, asOf).filter((q) => q.timestamp <= asOf);
    this.cache.push(...quotes);
    return quotes;
  }

  private async refreshAccessToken(): Promise<void> {
    const endpoint = this.opts.endpoint.replace(/\/$/, "");
    const transport = this.opts.transport ?? { fetch };
    const res = await transport.fetch(`${endpoint}/get_access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: this.opts.refreshToken }),
    });
    if (!res.ok) throw new DecisionError(`iFinD token http ${res.status}`);
    const body = (await res.json()) as { data?: { access_token?: string }; access_token?: string };
    const token = body.data?.access_token ?? body.access_token;
    if (!token) throw new DecisionError("iFinD token response has no access_token");
    this.accessToken = token;
  }
}

/** Accepts the common quantapi table shape and a flat fixture shape. */
export function parseIFindRealtime(body: unknown, fallbackTs: number): RawQuote[] {
  const root = asRecord(body);
  const tables = Array.isArray(root.tables) ? root.tables : Array.isArray(root.data) ? root.data : [root];
  const out: RawQuote[] = [];
  for (const item of tables) {
    const row = asRecord(item);
    const table = asRecord(row.table ?? row);
    const symbol = String(row.thscode ?? row.code ?? row.symbol ?? "");
    if (!symbol) continue;
    const price = firstNum(table, ["latest", "price", "last"]);
    if (price == null) continue;
    const timeRaw = row.time ?? table.time;
    const timestamp = typeof timeRaw === "number" ? timeRaw : typeof timeRaw === "string" ? Date.parse(timeRaw) || fallbackTs : fallbackTs;
    out.push({
      symbol,
      timestamp: Number.isFinite(timestamp) ? timestamp : fallbackTs,
      price,
      open: firstNum(table, ["open"]) ?? price,
      high: firstNum(table, ["high"]) ?? price,
      low: firstNum(table, ["low"]) ?? price,
      prevClose: firstNum(table, ["preClose", "prevClose"]) ?? price,
      volume: firstNum(table, ["volume"]) ?? 0,
      amount: firstNum(table, ["amount"]) ?? 0,
      bids: [1, 2, 3, 4, 5].map((i) => firstNum(table, [`bid${i}`]) ?? 0),
      asks: [1, 2, 3, 4, 5].map((i) => firstNum(table, [`ask${i}`]) ?? 0),
      bidVolumes: [1, 2, 3, 4, 5].map((i) => firstNum(table, [`bidSize${i}`, `bidVolume${i}`, `bidVol${i}`]) ?? 0),
      askVolumes: [1, 2, 3, 4, 5].map((i) => firstNum(table, [`askSize${i}`, `askVolume${i}`, `askVol${i}`]) ?? 0),
      suspended: String(firstCell(table, ["tradeStatus", "suspended"]) ?? "") === "停牌",
    });
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstCell(table: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in table) {
      const v = table[key];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function firstNum(table: Record<string, unknown>, keys: string[]): number | null {
  const v = firstCell(table, keys);
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

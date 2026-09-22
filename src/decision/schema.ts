import { DecisionError, type DecisionQuestion, type DecisionSchema } from "./types";

const direction5m: DecisionQuestion = {
  id: "direction_5m",
  type: "choice",
  prompt: "未来约 5 分钟，价格相对当前更可能怎么走？只在给定选项里分配概率。",
  options: [
    { id: "UP", description: "高于当前价格，幅度超过价差和成本" },
    { id: "FLAT", description: "大致持平，波动不足以覆盖成本" },
    { id: "DOWN", description: "低于当前价格，幅度超过价差和成本" },
  ],
};

const tradeability: DecisionQuestion = {
  id: "tradeability",
  type: "boolean",
  prompt: "按当前盘口、涨跌停和停牌状态，现在是否适合发出交易意图？",
  trueCriteria: "未停牌，未封死涨跌停，价差正常，规则允许下单",
  falseCriteria: "停牌、涨跌停封死，或规则不允许交易",
};

const direction15m: DecisionQuestion = {
  id: "direction_15m",
  type: "choice",
  prompt: "未来约 15 分钟的价格路径更接近哪一档？",
  options: [
    { id: "STRONG_UP", description: "明显上涨" },
    { id: "UP", description: "小幅上涨" },
    { id: "FLAT", description: "基本持平" },
    { id: "DOWN", description: "小幅下跌" },
    { id: "STRONG_DOWN", description: "明显下跌" },
  ],
};

const volatility5m: DecisionQuestion = {
  id: "volatility_5m",
  type: "score",
  prompt: "未来约 5 分钟的波动更接近哪一档？从低到高。",
  levels: [
    { id: "LOW", description: "波动很低，价差几乎不动" },
    { id: "MEDIUM", description: "常规波动" },
    { id: "HIGH", description: "波动明显放大" },
  ],
};

const tradeAction: DecisionQuestion = {
  id: "trade_action",
  type: "choice",
  prompt: "若只能在买入、持有、卖出里选一个交易意图，当前状态更支持哪一个？这是候选偏好，不是成交概率。",
  options: [
    { id: "BUY", description: "买入" },
    { id: "HOLD", description: "不交易" },
    { id: "SELL", description: "卖出" },
  ],
};

export const SCHEMAS: Record<string, DecisionSchema> = {
  direction_5m_v1: {
    id: "direction_5m_v1",
    version: "v1",
    requiresDistribution: true,
    questions: [direction5m, tradeability],
  },
  direction_15m_v1: {
    id: "direction_15m_v1",
    version: "v1",
    requiresDistribution: true,
    questions: [direction15m, tradeability],
  },
  volatility_5m_v1: {
    id: "volatility_5m_v1",
    version: "v1",
    requiresDistribution: true,
    questions: [volatility5m],
  },
  tradeability_v1: {
    id: "tradeability_v1",
    version: "v1",
    requiresDistribution: true,
    questions: [tradeability],
  },
  trade_action_v1: {
    id: "trade_action_v1",
    version: "v1",
    requiresDistribution: true,
    questions: [tradeAction],
  },
  /** Same questions as direction_5m_v1, but a text model may answer with a point label. */
  direction_5m_label_v1: {
    id: "direction_5m_label_v1",
    version: "v1",
    requiresDistribution: false,
    questions: [direction5m, tradeability],
  },
};

export function getSchema(id: string): DecisionSchema {
  const schema = SCHEMAS[id];
  if (!schema) throw new DecisionError(`unknown decision schema ${id}`);
  return schema;
}

export function questionOptionIds(q: DecisionQuestion): string[] {
  if (q.type === "choice") return q.options.map((o) => o.id);
  if (q.type === "score") return q.levels.map((o) => o.id);
  return ["YES", "NO"];
}

export function validateSchema(schema: DecisionSchema): void {
  if (!schema.id || schema.questions.length === 0) throw new DecisionError("schema needs an id and at least one question");
  const ids = new Set<string>();
  for (const q of schema.questions) {
    if (ids.has(q.id)) throw new DecisionError(`duplicate question id ${q.id}`);
    ids.add(q.id);
    if (q.type === "choice" && q.options.length < 2) throw new DecisionError(`${q.id} needs at least two options`);
    if (q.type === "score" && (q.levels.length < 2 || q.levels.length > 26)) throw new DecisionError(`${q.id} score levels must be 2 to 26`);
    if (q.type === "choice" && q.options.length > 255) throw new DecisionError(`${q.id} has more than 255 options`);
  }
}

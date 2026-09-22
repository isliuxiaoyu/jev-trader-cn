# A 股 Typed Decision 实验台

这是一个面向中国大陆 A 股的可插拔决策模型实验台。Jev、AgentJev、Nimble、Bespoke-Nimble-9B、Decider 和传统基线都只是 `DecisionModel`。策略、行情、规则和评价不知道自己面对的是哪一个模型。

第一阶段做模拟交易。真实券商接口默认关闭。

## 原则

- Decision Model Agnostic
- A-share First
- Paper Trading First
- Prediction Before Automation
- No Look-ahead Bias
- Adapter Based
- Reproducible Experiments
- Local Model Friendly
- Real Broker Disabled by Default

预测和交易是两条管道。模型输出的是某个问题的候选分布。`DecisionPolicy` 才把它解释成买入、持有或卖出。规则层可以否决。评价用决策时刻之后的价格，那些价格不会进入 `DecisionRequest`。

`topProbability` 是当前候选集合里的选择概率，不是校准后的成功概率。原始分布、最高概率和 margin 会原样记入 Prediction Log，校准留在评价阶段。

## 数据流

```
A 股数据
  -> MarketDataProvider
  -> AStockFeatureEngine
  -> AStockTradeState
  -> DecisionRequest(state, schema, asOf)
  -> DecisionModel
  -> DecisionResponse
  -> DecisionPolicy
  -> AStockTradingRules
  -> PaperTrader
  -> PredictionLog / Evaluation
  -> Dashboard
```

`replay`、`backtest`、`paper` 共用上面这条管道。回放只记预测。回测和模拟盘才会下模拟单。

## 运行

```sh
cp .env.example .env
bun install
bun test
bun run typecheck
bun run start
```

默认是 `MODEL=baseline-momentum`、`DATA=mock`、`MODE=replay`。不需要下载模型，也不需要行情账号。看板在 `web/`，接口默认 `http://127.0.0.1:3000`。

切换模型只改环境变量：

```sh
MODEL=baseline-momentum bun run start
MODEL=agent-jev MODEL_ENDPOINT=http://127.0.0.1:8149 bun run start
MODEL=nimble-9b MODEL_ENDPOINT=http://127.0.0.1:8149 MODEL_BASE=Qwen/Qwen3.5-9B bun run start
MODEL=jev TYPESAFE_AI_API_KEY=... bun run start
MODEL=decider-2b MODEL_ENDPOINT=http://127.0.0.1:8149 bun run start
```

没有本地服务时，AgentJev、Nimble、Decider 会在调用前报 `[ADAPTER LIMITATION]`，不会编造分布。测试通过注入的 fixture 跑适配器，CI 不下载权重。

同一时刻把多个模型打在同一份状态上：

```sh
MODEL=baseline-momentum COMPARE_MODELS=baseline-random
```

比较模型只写预测日志。下单只用 `MODEL`。评价表并列展示，不产生“最佳模型”。

## 一次实验

```
2026-A-001
数据: mock 或 ifind 或 csv
特征: v1
模型: AgentJev-0.6B 或其他注册模型
模式: direction_5m_v1
策略: threshold-v1
规则: AStock-MainBoard-v1
成交: BestAskPlusSlippage
```

规则档还包括 `AStock-ChiNext-v1`、`AStock-STAR-v1`、`AStock-ST-v1`。策略还有 `momentum-v1`、`probability-edge-v1`、`consensus-v1`。

## 模型

| id | 类型 | 说明 |
| --- | --- | --- |
| baseline-momentum | 基线 | 用 5 分钟收益生成分布 |
| baseline-random | 基线 | 由标的、时间和问题确定的分布 |
| agent-jev | typed decision | 一次前向，零 token 解码。需要本地 AgentJev 服务 |
| nimble | typed decision | boolean / choice / score，返回候选概率 |
| nimble-9b | LoRA | `Qwen/Qwen3.5-9B` 加 `bespokelabs/Bespoke-Nimble-9B`，适配器不是完整模型 |
| decider-2b | typed decision | 复用同一套 Typed Decision HTTP 适配器 |
| jev | typed decision | TypeSafe 评价接口，保留为其中一个适配器 |
| llm | TEXT MODEL | OpenAI 兼容接口。不能用于要求分布的 schema |

Typed decision 适配器不读取 `MODEL_TEMPERATURE`。只有 `llm` 声明了 temperature。

本地加载说明在 `scripts/serve_typed_model.py`。

## 布局

```
src/decision     DecisionModel, schema, registry, policy
src/models       适配器和基线
src/market       AStockTradeState, 特征, mock / csv / ifind
src/rules        A 股规则档
src/broker       PaperTrader。QMT 构造时直接拒绝
src/eval         预测日志和评价指标
src/pipeline     replay / backtest / paper
legacy/crypto    原来的 Monad / Kuru 循环，已隔离
web              看板
```

iFinD 只出现在 `IFindMarketDataProvider`。特征引擎只接收规范化行情。

## 看板

看板显示当前模型、版本、Decision Schema、股票、市场状态、动作，以及完整概率分布、margin、延迟。点开一条记录可以看到问题、选项、分布和当时的状态摘要。旁边是模拟委托、成交、持仓、盈亏，以及不排名的评价表。

## 测试

```sh
bun test
bun run typecheck
```

覆盖模型接口、注册表、能力检查、概率归一、盘口失衡、特征、iFinD 解析、T+1、涨跌停、停牌、资金、部分成交、费用、滑点、盈亏、回放、回测、评价、无前视、模型版本，以及 AgentJev、Nimble、Decider、Jev、基线适配器。完整权重下载不是默认测试。

## 旧的链上循环

`legacy/crypto` 保留原来的 Kuru 盘口和 Monad 发单代码。A 股模块不依赖它。`ethers` 和 `@kuru-labs/kuru-sdk` 只给这段旧代码使用。

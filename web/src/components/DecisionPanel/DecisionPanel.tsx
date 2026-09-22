"use client";

import type { Tick } from "@/lib/types";
import { fmtPct, fmtPx } from "@/lib/format";
import styles from "./DecisionPanel.module.css";

const SUMMARY_KEYS = ["spreadBps", "bookImbalance", "return5m", "return1m", "volatility", "canBuy", "canSell", "limitUp", "limitDown", "suspended"] as const;

export default function DecisionPanel({ tick }: { tick: Tick | null }) {
  if (!tick) {
    return (
      <div className={styles.panel}>
        <section className={styles.section}>
          <div className={styles.sectionLabel}>模型输出</div>
          <div className={styles.order}>等待第一条决策</div>
        </section>
      </div>
    );
  }
  const color = tick.action === "BUY" ? "var(--buy-ink)" : tick.action === "SELL" ? "var(--sell-ink)" : "var(--ink-2)";
  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>当前输出</div>
        <div className={styles.headline} style={{ color }}>
          <span className={styles.headlineWord}>{tick.action}</span>
          <span className={styles.headlinePct}>{fmtPct(tick.topProbability)}</span>
        </div>
        <div className={styles.order}>{tick.question}</div>
        {tick.options.map((opt) => (
          <Bar key={opt} label={opt} value={tick.probabilities[opt] ?? 0} active={opt === tick.selectedValue} />
        ))}
        <div className={styles.order}>
          最高选项概率 {fmtPct(tick.topProbability)}，与次高差距 {tick.margin.toFixed(2)}。这是候选集合里的选择概率，不是校准后的成功概率。
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>为什么是这个分布</div>
        <div className={styles.order}>问题 {tick.questionId}，选项 {tick.options.join(" / ")}</div>
        {tick.answers.filter((a) => a.questionId !== tick.questionId).map((a) => (
          <div key={a.questionId} className={styles.order}>
            {a.questionId}: {a.selectedValue} {Object.entries(a.probabilities).map(([k, v]) => `${k} ${fmtPct(v)}`).join("  ")}
          </div>
        ))}
        <div className={styles.order}>
          输入摘要: 价格 {fmtPx(tick.price)}
          {SUMMARY_KEYS.map((key) => `  ${key} ${String(tick.stateSummary[key] ?? "-")}`).join("")}
        </div>
        {tick.comparisons.length > 1 ? (
          <div className={styles.order}>
            {tick.comparisons.map((c) => `${c.model} ${c.selectedValue} ${fmtPct(c.topProbability)}`).join("  ")}
          </div>
        ) : null}
        <div className={styles.order}>
          策略 {tick.policyId}，规则 {tick.guardOk ? "通过" : "拦截"} {tick.guardReasons.join(", ")}
        </div>
      </section>
    </div>
  );
}

function Bar({ label, value, active }: { label: string; value: number; active: boolean }) {
  const buy = label === "BUY" || label === "UP" || label === "STRONG_UP";
  const sell = label === "SELL" || label === "DOWN" || label === "STRONG_DOWN";
  const ink = buy ? "var(--buy-ink)" : sell ? "var(--sell-ink)" : "var(--ink-2)";
  const fill = buy ? "var(--buy-bar)" : sell ? "var(--sell-bar)" : "var(--hold-cell)";
  return (
    <div className={styles.row}>
      <span className={styles.label} style={{ color: ink, opacity: active ? 1 : 0.45 }}>{label}</span>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: fill }} />
      </div>
      <span className={styles.pct}>{fmtPct(value)}</span>
    </div>
  );
}

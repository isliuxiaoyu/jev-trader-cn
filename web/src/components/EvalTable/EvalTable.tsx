"use client";

import type { Meta } from "@/lib/types";

function n(value: number | null | undefined, digits = 3): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

export default function EvalTable({ meta }: { meta: Meta | null }) {
  const rows = meta?.evaluation?.byModel ?? [];
  const exp = meta?.experiment;
  return (
    <section style={{ padding: "12px 4px 0", overflow: "auto", maxHeight: 220 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--muted-2)", marginBottom: 8 }}>实验与评价</div>
      {exp ? (
        <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 8, lineHeight: 1.5 }}>
          {exp.id} / 数据 {exp.marketDataProvider} / 特征 {exp.featureVersion} / 模型 {exp.model} {exp.modelVersion} / 模式 {exp.schema} / 策略 {exp.policy} / 规则 {exp.tradingRuleProfile} / 成交 {exp.executionModel}
        </div>
      ) : null}
      {rows.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12 }}>评价会在回放结束后并列出现，这里不给模型排名。</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ color: "var(--muted)", textAlign: "left" }}>
              {["模型", "问题", "样本", "Top1", "LogLoss", "Brier", "ECE", "均收益", "MFE", "MAE", "延迟"].map((h) => <th key={h} style={{ fontWeight: 500, padding: "4px 6px" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.model}-${row.modelVersion}-${row.questionId}`}>
                <td style={{ padding: "4px 6px" }}>{row.model}</td>
                <td style={{ padding: "4px 6px" }}>{row.questionId}</td>
                <td style={{ padding: "4px 6px" }}>{row.labeled}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.top1Accuracy)}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.logLoss)}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.brier)}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.ece)}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.avgFutureReturn, 4)}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.avgMfe, 4)}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.avgMae, 4)}</td>
                <td style={{ padding: "4px 6px" }}>{n(row.avgLatencyMs, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

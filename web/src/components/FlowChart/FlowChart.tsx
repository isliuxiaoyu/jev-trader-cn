"use client";

import type { Tick } from "@/lib/types";
import { fmtNum, fmtPx } from "@/lib/format";
import styles from "./FlowChart.module.css";

export default function FlowChart({ events, latest }: { events: Tick[]; latest: Tick | null }) {
  const points = events.slice(-180);
  const prices = points.map((p) => p.price);
  const lo = prices.length ? Math.min(...prices) : 0;
  const hi = prices.length ? Math.max(...prices) : 1;
  const span = hi - lo || 1;
  const d = points.map((p, i) => {
    const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
    const y = 100 - ((p.price - lo) / span) * 100;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="价格路径">
          <path className={styles.line} d={d} vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ position: "absolute", left: 16, top: 14, right: 16 }}>
          <div style={{ fontSize: 28, fontVariantNumeric: "tabular-nums" }}>{latest ? fmtPx(latest.price) : "-"}</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            {latest ? `持仓 ${fmtNum(latest.position.qty)}  可用 ${fmtNum(latest.position.available)}  费用 ${fmtNum(latest.pnl.fees)}` : "价格"}
          </div>
        </div>
      </div>
    </div>
  );
}

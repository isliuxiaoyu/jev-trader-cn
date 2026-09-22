"use client";

import type { Meta, Tick } from "@/lib/types";
import { fmtNum, fmtPx } from "@/lib/format";
import styles from "./StatsRow.module.css";

export default function StatsRow({ latest, meta }: { latest: Tick | null; meta: Meta | null }) {
  const pnl = latest?.pnl;
  return (
    <div className={styles.stats}>
      <span>价格 {latest ? fmtPx(latest.price) : "-"}</span>
      <span>动作 {latest?.action ?? "-"}</span>
      <span>差距 {latest ? latest.margin.toFixed(2) : "-"}</span>
      <span>延迟 {latest ? `${Math.round(latest.latencyMs)} ms` : "-"}</span>
      <span>持仓 {latest ? fmtNum(latest.position.qty) : "-"}</span>
      <span>现金 {pnl ? fmtNum(pnl.cash) : "-"}</span>
      <span>盈亏 {pnl ? fmtNum(pnl.total) : "-"}</span>
      <span className={styles.spacer} />
      <span>{meta?.policy ?? ""}</span>
    </div>
  );
}

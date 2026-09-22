"use client";

import type { ConnectionState, Meta, Tick } from "@/lib/types";
import styles from "./Header.module.css";

const OFFLINE: Partial<Record<ConnectionState, string>> = {
  connecting: "connecting",
  reconnecting: "reconnecting",
};

export default function Header({ meta, latest, connection }: { meta: Meta | null; latest: Tick | null; connection: ConnectionState }) {
  const offline = OFFLINE[connection] ?? null;
  return (
    <div className={styles.header}>
      <span className={styles.brand}>A股决策实验</span>
      <span className={styles.meta}>{meta?.symbol ?? latest?.symbol ?? "等待行情"}</span>
      <span className={styles.meta}>{meta?.mode ?? ""}</span>
      <span className={styles.spacer} />
      {offline ? <span className={styles.offline}>{offline}</span> : null}
      {meta?.model ? <span className={styles.badge} style={{ background: "var(--badge-jev-bg)", color: "var(--badge-jev-fg)" }}>{meta.model}</span> : null}
      {meta?.modelVersion ? <span className={styles.badge} style={{ background: "var(--badge-standin-bg)", color: "var(--badge-standin-fg)" }}>{meta.modelVersion}</span> : null}
      {meta?.schema ? <span className={styles.meta}>{meta.schema}</span> : null}
    </div>
  );
}

"use client";

import type { Tick } from "@/lib/types";
import { fmtPx } from "@/lib/format";
import styles from "./Feed.module.css";

export default function Feed({ events, selectedTs, onSelect }: { events: Tick[]; selectedTs: number | null; onSelect: (ts: number) => void }) {
  const rows = events.slice(-12).reverse();
  return (
    <section className={styles.feed}>
      <div className={styles.label}>最近预测与委托</div>
      <div className={styles.list}>
        {rows.length === 0 ? <div className={styles.empty}>还没有决策</div> : rows.map((event) => {
          const kind = event.action === "BUY" ? styles.kindBuy : event.action === "SELL" ? styles.kindSell : styles.kindLate;
          const order = event.fill
            ? `成交 ${event.fill.qty} @ ${fmtPx(event.fill.price)}`
            : event.order
              ? `${event.order.status} ${event.order.filledQty}/${event.order.qty}`
              : "无委托";
          return (
            <button
              key={event.ts}
              type="button"
              className={[styles.row, kind, selectedTs === event.ts ? styles.newest : ""].join(" ")}
              onClick={() => onSelect(event.ts)}
            >
              <span className={`${styles.cell} ${styles.word}`}>{event.action}</span>
              <span className={`${styles.cell} ${styles.conf}`}>{event.selectedValue} {Math.round(event.topProbability * 100)}%</span>
              <span className={`${styles.cell} ${styles.lat}`}>{event.margin.toFixed(2)}</span>
              <span className={`${styles.cell} ${styles.detail}`}>{order}</span>
              <span className={`${styles.cell} ${styles.tx}`}>{fmtPx(event.price)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import DecisionPanel from "@/components/DecisionPanel/DecisionPanel";
import EvalTable from "@/components/EvalTable/EvalTable";
import Feed from "@/components/Feed/Feed";
import FlowChart from "@/components/FlowChart/FlowChart";
import Header from "@/components/Header/Header";
import StatsRow from "@/components/StatsRow/StatsRow";
import { useFeed } from "@/lib/useFeed";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3000";

export default function Page() {
  const feed = useFeed(API_URL);
  const [selectedTs, setSelectedTs] = useState<number | null>(null);
  const selected = selectedTs == null ? feed.latest : feed.events.find((event) => event.ts === selectedTs) ?? feed.latest;

  return (
    <div className="card">
      <Header meta={feed.meta} latest={feed.latest} connection={feed.connection} />
      <StatsRow latest={selected} meta={feed.meta} />
      <div className={styles.main}>
        <div className={styles.left}>
          <div className={styles.chartWrap}>
            <FlowChart events={feed.events} latest={selected} />
          </div>
          <EvalTable meta={feed.meta} />
        </div>
        <div className={styles.right}>
          <DecisionPanel tick={selected} />
          <Feed events={feed.events} selectedTs={selected?.ts ?? null} onSelect={setSelectedTs} />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useReducer } from "react";
import type { ConnectionState, FeedState, Meta, Tick } from "./types";

const CAP = 1000;
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 10_000;
const STALE_MS = 45_000;

type Action =
  | { type: "snapshot"; meta: Meta; history: Tick[] }
  | { type: "tick"; event: Tick }
  | { type: "connection"; connection: ConnectionState };

const initial: FeedState = { meta: null, events: [], latest: null, connection: "connecting" };

function reducer(state: FeedState, action: Action): FeedState {
  if (action.type === "connection") {
    return state.connection === action.connection ? state : { ...state, connection: action.connection };
  }
  if (action.type === "snapshot") {
    const events = action.history.length > CAP ? action.history.slice(-CAP) : action.history;
    return { meta: action.meta, events, latest: events.at(-1) ?? null, connection: "live" };
  }
  const events = state.events.concat(action.event).slice(-CAP);
  return { ...state, events, latest: action.event, connection: "live" };
}

function asMeta(raw: Record<string, unknown>): Meta {
  const experiment = raw.experiment && typeof raw.experiment === "object" ? raw.experiment as Meta["experiment"] : null;
  const evaluation = raw.evaluation && typeof raw.evaluation === "object" ? raw.evaluation as Meta["evaluation"] : null;
  return {
    model: String(raw.model ?? ""),
    modelVersion: String(raw.modelVersion ?? ""),
    schema: String(raw.schema ?? ""),
    policy: String(raw.policy ?? ""),
    symbol: String(raw.symbol ?? raw.market ?? ""),
    mode: String(raw.mode ?? ""),
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    experiment,
    evaluation,
  };
}

export function useFeed(apiUrl: string): FeedState {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const base = (apiUrl || "").replace(/\/+$/, "");
    let closed = false;
    let attempt = 0;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;

    const armStale = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => { if (!closed) schedule(); }, STALE_MS);
    };
    const teardown = () => {
      if (es) { es.onopen = null; es.onerror = null; es.close(); es = null; }
      if (staleTimer) clearTimeout(staleTimer);
    };
    const schedule = () => {
      if (closed) return;
      teardown();
      dispatch({ type: "connection", connection: "reconnecting" });
      const delay = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** attempt);
      attempt++;
      retryTimer = setTimeout(connect, delay);
    };
    const on = (type: string, fn: (data: unknown) => void) => {
      es?.addEventListener(type, (raw: Event) => {
        armStale();
        const payload = (raw as MessageEvent).data;
        if (typeof payload !== "string" || !payload) return;
        try { fn(JSON.parse(payload)); } catch { /* ignore malformed frames */ }
      });
    };

    function connect() {
      if (closed) return;
      dispatch({ type: "connection", connection: attempt === 0 ? "connecting" : "reconnecting" });
      es = new EventSource(`${base}/events`);
      es.onopen = () => { attempt = 0; dispatch({ type: "connection", connection: "live" }); armStale(); };
      es.onerror = () => { if (!closed) schedule(); };
      on("snapshot", (data) => {
        const row = (data ?? {}) as Record<string, unknown>;
        const history = Array.isArray(row.history) ? row.history as Tick[] : [];
        dispatch({ type: "snapshot", meta: asMeta(row), history });
      });
      on("tick", (data) => dispatch({ type: "tick", event: data as Tick }));
      on("ping", () => dispatch({ type: "connection", connection: "live" }));
    }

    connect();
    return () => { closed = true; if (retryTimer) clearTimeout(retryTimer); teardown(); };
  }, [apiUrl]);

  return state;
}

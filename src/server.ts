import type { AppConfig } from "./config";
import type { EvaluationReport } from "./eval/metrics";
import type { PredictionRecord } from "./eval/log";
import type { Experiment, TickRecord } from "./pipeline/runner";

export interface ServerState {
  config: AppConfig;
  experiment: Experiment;
  ticks: TickRecord[];
  predictions: PredictionRecord[];
  evaluation: EvaluationReport | null;
  startedAt: number;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

export function startServer(state: ServerState) {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, type: string, data: unknown) => {
    try { c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { clients.delete(c); }
  };
  const snapshot = () => ({
    model: state.experiment.model,
    modelVersion: state.experiment.modelVersion,
    schema: state.experiment.schema,
    policy: state.experiment.policy,
    symbol: state.config.symbol,
    mode: state.config.mode,
    dryRun: true,
    market: state.config.symbol,
    startedAt: state.startedAt,
    experiment: state.experiment,
    evaluation: state.evaluation,
    history: state.ticks,
    latest: state.ticks.at(-1) ?? null,
  });
  setInterval(() => clients.forEach((c) => send(c, "ping", Date.now())), 15_000);

  Bun.serve({
    port: state.config.port,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (pathname === "/") return json(snapshot());
      if (pathname === "/history") return json(state.ticks);
      if (pathname === "/predictions") return json(state.predictions);
      if (pathname === "/evaluation") return json(state.evaluation);
      if (pathname === "/experiment") return json(state.experiment);
      if (pathname === "/events") {
        let current: ReadableStreamDefaultController<Uint8Array> | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            current = c;
            clients.add(c);
            send(c, "snapshot", snapshot());
            req.signal.addEventListener("abort", () => { if (current) clients.delete(current); });
          },
          cancel() { if (current) clients.delete(current); },
        });
        return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }
      return json({ error: "not found" }, 404);
    },
  });

  return {
    publish(result: { ticks: TickRecord[]; predictions: PredictionRecord[]; evaluation: EvaluationReport; experiment: Experiment }) {
      state.ticks = result.ticks;
      state.predictions = result.predictions;
      state.evaluation = result.evaluation;
      state.experiment = result.experiment;
      const snap = snapshot();
      clients.forEach((c) => send(c, "snapshot", snap));
    },
    broadcast(tick: TickRecord) {
      state.ticks.push(tick);
      if (state.ticks.length > 1000) state.ticks.shift();
      clients.forEach((c) => send(c, "tick", tick));
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

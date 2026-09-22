import { loadConfig } from "./config";
import { buildRuntime } from "./platform/bootstrap";
import { startServer } from "./server";

const config = loadConfig();
const runtime = buildRuntime(config);
const server = startServer({
  config,
  experiment: runtime.pipeline.experiment,
  ticks: [],
  predictions: [],
  evaluation: null,
  startedAt: Date.now(),
});

if (config.ignoredParams.length) {
  console.log(`ignored model params for ${config.modelId}: ${config.ignoredParams.join(", ")}`);
}

console.log(
  [
    "astock-decision",
    `experiment=${runtime.pipeline.experiment.id}`,
    `mode=${config.mode}`,
    `model=${config.modelId}`,
    `version=${runtime.pipeline.experiment.modelVersion}`,
    `schema=${config.schemaId}`,
    `policy=${config.policyId}`,
    `rules=${config.rulesId}`,
    `execution=${config.executionId}`,
    `symbol=${config.symbol}`,
    `data=${config.data}`,
    `decisions=${runtime.times.length}`,
    `port=${config.port}`,
  ].join(" "),
);

if (config.mode === "paper") {
  const result = await runtime.runPaper((tick) => {
    server.broadcast(tick);
    console.log(`${tick.symbol} ${tick.action} top=${tick.topProbability.toFixed(2)} margin=${tick.margin.toFixed(2)} ${tick.latencyMs.toFixed(0)}ms`);
  });
  server.publish(result);
} else {
  const result = await runtime.runBatch();
  server.publish(result);
  const preview = result.evaluation.byModel.map((m) => `${m.model} acc=${m.top1Accuracy == null ? "na" : m.top1Accuracy.toFixed(3)} n=${m.labeled}`).join(" | ");
  console.log(`predictions=${result.predictions.length} ${preview}`);
}

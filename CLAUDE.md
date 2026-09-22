---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Project principles

This repository is an A-share research bench for pluggable typed decision models. It is not a Jev-only trading bot, and the A-share path does not place Monad or Kuru orders.

Keep these true:

- Decision Model Agnostic. Strategy, market data, rules, and evaluation do not branch on a model id.
- A-share First. Market state, features, sessions, T+1, price limits, and fees describe mainland China cash equities.
- Paper Trading First. `PaperTrader` is the broker. Real broker adapters must refuse to run.
- Prediction Before Automation. A model distribution is not an order. `DecisionPolicy` interprets it, then rules may reject it.
- No Look-ahead Bias. A decision at time T sees only data with timestamp <= T. Future prices are for evaluation.
- Adapter Based. New models implement `DecisionModel` and register. Do not add `if (model === "jev")` in the pipeline.
- Reproducible Experiments. Logs keep model version, schema, policy, rule profile, and execution model.
- Local Model Friendly. Typed models prefer one forward pass and a candidate distribution. Do not wrap AgentJev or Nimble in long chain-of-thought JSON.
- Real Broker Disabled by Default.

`topProbability` is the chosen candidate's mass inside the supplied options. It is not a calibrated probability that the choice is correct. Preserve the distribution, the top probability, and the margin.

Bespoke-Nimble-9B is a LoRA adapter on Qwen3.5-9B, not a standalone checkpoint.

The old Monad / Kuru loop lives in `legacy/crypto` and must not be imported by `src/`.

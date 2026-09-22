# 看板

Next.js 看板，读取决策服务的 SSE。

```sh
bun install
NEXT_PUBLIC_API_URL=http://127.0.0.1:3000 bun run dev
```

服务端先在仓库根目录执行 `bun run start`。默认模型是动量基线，数据是合成行情，模式是回放。

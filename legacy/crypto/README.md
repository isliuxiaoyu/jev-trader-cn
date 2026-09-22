# Legacy Monad / Kuru loop

This directory is the original bot: a TypeSafe Jev call on the Kuru MON-USDC book, one post-only order per Monad block.

It is isolated from the A-share platform in `src/`. The A-share modules do not import this code, `ethers`, or `@kuru-labs/kuru-sdk`.

Run it only when you still want the old crypto loop:

```sh
bun run legacy
```

The packages `ethers` and `@kuru-labs/kuru-sdk` stay in the root manifest because these files import them. They are not part of the A-share decision path.

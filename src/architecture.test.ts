import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

test("A-share core does not import the Monad or Kuru stack", () => {
  const files = walk("src").filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("import") && !trimmed.includes("from \"")) continue;
      if (/kuru-sdk|from "ethers"|ethers\/|monad/i.test(trimmed)) offenders.push(`${file}: ${trimmed}`);
    }
  }
  expect(offenders).toEqual([]);
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

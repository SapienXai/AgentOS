import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();

test("protected login keeps mobile status quiet and content comfortably inset", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");

  assert.match(source, /hidden items-center gap-2[^\n]+sm:flex[\s\S]*?Instance locked/);
  assert.equal(source.match(/px-6[^\n]+sm:px-8/g)?.length, 2);
});

test("protected login title scales down fluidly on small screens", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");

  assert.match(source, /text-\[clamp\(1\.85rem,8\.5vw,2\.1rem\)\]/);
  assert.match(source, /sm:text-\[2\.5rem\]/);
  assert.match(source, /lg:text-\[2\.75rem\]/);
});

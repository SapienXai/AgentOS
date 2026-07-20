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

test("protected login composes a theme-aware glass access card", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");
  const styles = await readFile(path.join(rootDir, "app/globals.css"), "utf8");

  assert.match(source, /<Card className="lock-glass-card/);
  assert.match(source, /<CardHeader[^>]+lock-glass-divider/);
  assert.match(source, /<CardContent/);
  assert.match(source, /<CardFooter/);
  assert.equal(source.match(/className="lock-glass-input/g)?.length, 2);
  assert.match(styles, /--lock-glass-surface-alpha: 0\.22/);
  assert.match(styles, /\.dark[\s\S]+--lock-glass-surface-alpha: 0\.36/);
  assert.match(styles, /--lock-glass-foreground: 17 27 47/);
  assert.match(styles, /\.dark[\s\S]+--lock-glass-foreground: 244 248 255/);
  assert.match(styles, /backdrop-filter: blur\(20px\) saturate\(1\.52\)/);
  assert.match(source, /className="lock-glass-chip/);
  assert.match(styles, /\.lock-glass-chip \{/);
});

test("celestial moon renders as a complete luminous sphere", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/celestial-lock-background.tsx"), "utf8");

  assert.match(source, /data-celestial-body="moon"/);
  assert.match(source, /#ffffff_0%,#fbfdff_28%,#e8effc_62%,#b6c7e5_100%/);
  assert.doesNotMatch(source, /after:bg-\[#101b38\]/);
});

test("celestial stars twinkle in independent reduced-motion-aware layers", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/celestial-lock-background.tsx"), "utf8");

  assert.match(source, /BRIGHT_STAR_FIELD/);
  assert.match(source, /SOFT_STAR_FIELD/);
  assert.match(source, /FINE_STAR_FIELD/);
  assert.ok((source.match(/animate=\{reduceMotion \? undefined/g) ?? []).length >= 3);
  assert.match(source, /duration: 8\.5/);
  assert.match(source, /duration: 11\.5/);
  assert.match(source, /duration: 14/);
});

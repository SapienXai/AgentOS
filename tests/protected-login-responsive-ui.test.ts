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

  assert.match(source, /text-\[clamp\(1\.75rem,8vw,2rem\)\]/);
  assert.match(source, /sm:text-\[2\.25rem\]/);
  assert.match(source, /lg:text-\[2\.35rem\]/);
  assert.match(source, /font-sans text-\[clamp/);
  assert.match(source, /leading-\[1\.05\]/);
  assert.match(source, /tracking-\[-0\.03em\]/);
  assert.match(source, /text-left text-white/);
  assert.match(source, />Control plane locked<\/h1>/);
  assert.match(source, />Authenticate to unlock this instance\.<\/p>/);
  assert.match(source, /Need a reset\? Run[\s\S]*agentos auth reset[\s\S]*<\/p>/);
});

test("protected login uses Piko while checking instance protection", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");

  assert.match(source, /function AuthSplash\(\)[\s\S]*?<PikoLoader\s+open\s+title="Checking protection"/);
  assert.match(source, /description="Confirming this session can access AgentOS\."/);
  assert.match(source, /aria-busy="true" aria-label="Checking protection"/);
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
  assert.match(source, /font-sans text-\[15px\] font-medium leading-5 tracking-\[-0\.02em\]">Operator access/);
  assert.equal(source.match(/text-\[10px\] font-medium tracking-\[0\.16em\] text-muted-foreground/g)?.length, 2);
  assert.equal(source.match(/lock-glass-input h-11 rounded-xl[^\"]*text-\[15px\]/g)?.length, 2);
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

test("celestial background layers the dark splash video beneath its sky effects", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/celestial-lock-background.tsx"), "utf8");
  const styles = await readFile(path.join(rootDir, "app/globals.css"), "utf8");

  assert.match(source, /data-lockscreen-splash-video/);
  assert.match(source, /src="\/assets\/agentos-splash\.mp4"/);
  assert.match(source, /poster="\/assets\/agentos-splash-poster\.jpg"/);
  assert.match(source, /autoPlay=\{reduceMotion !== true\}/);
  assert.match(source, /video\.pause\(\)/);
  assert.match(styles, /\.lockscreen-splash-video \{/);
  assert.match(styles, /opacity: 0\.92/);
  assert.match(styles, /filter: brightness\(0\.64\) saturate\(0\.94\)/);
  assert.match(styles, /\.lockscreen-video-wash \{/);
  assert.match(source, /lockscreen-crt-overlay/);
  assert.match(styles, /\.lockscreen-crt-overlay \{/);
  assert.match(styles, /\.lockscreen-crt-overlay::before \{/);
  assert.match(styles, /repeating-linear-gradient\(0deg/);
  assert.match(styles, /animation: lockscreen-crt-scanline 7\.5s linear infinite/);
  assert.match(styles, /@keyframes lockscreen-crt-scanline/);

  const skyGradientIndex = source.indexOf("opacity-[0.22]");
  const videoIndex = source.indexOf("data-lockscreen-splash-video");
  const moonIndex = source.indexOf('data-celestial-body="moon"');
  assert.ok(skyGradientIndex >= 0 && skyGradientIndex < videoIndex && videoIndex < moonIndex);
});

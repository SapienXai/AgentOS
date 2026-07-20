import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();

type WebManifest = {
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  icons?: Array<{ src?: string; sizes?: string; purpose?: string }>;
};

test("PWA manifest provides installable identity, black chrome, and dedicated maskable icons", async () => {
  const manifest = JSON.parse(await readText("public/site.webmanifest")) as WebManifest;

  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#000000");
  assert.equal(manifest.theme_color, "#000000");
  assert.ok(manifest.icons?.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons?.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons?.some((icon) => icon.sizes === "192x192" && icon.purpose === "maskable"));
  assert.ok(manifest.icons?.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("PWA icon and Apple splash assets have their declared pixel dimensions", async () => {
  const expectedDimensions = new Map<string, readonly [number, number]>([
    ["public/pwa/icon-192.png", [192, 192]],
    ["public/pwa/icon-512.png", [512, 512]],
    ["public/pwa/icon-maskable-192.png", [192, 192]],
    ["public/pwa/icon-maskable-512.png", [512, 512]],
    ["public/pwa/apple-touch-icon.png", [180, 180]],
    ["public/pwa/splash-1170x2532.png", [1170, 2532]],
    ["public/pwa/splash-1179x2556.png", [1179, 2556]],
    ["public/pwa/splash-1284x2778.png", [1284, 2778]],
    ["public/pwa/splash-1290x2796.png", [1290, 2796]],
    ["public/pwa/splash-2048x2732.png", [2048, 2732]]
  ]);

  for (const [relativePath, expected] of expectedDimensions) {
    assert.deepEqual(await readPngDimensions(relativePath), expected, relativePath);
  }
});

test("root metadata exposes Apple standalone and splash configuration", async () => {
  const layout = await readText("app/layout.tsx");

  assert.match(layout, /themeColor:\s*"#000000"/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /appleWebApp:\s*\{/);
  assert.match(layout, /statusBarStyle:\s*"black-translucent"/);
  assert.match(layout, /splash-1170x2532\.png/);
  assert.match(layout, /splash-2048x2732\.png/);
  assert.match(layout, /<PwaServiceWorkerRegistration \/>/);
});

test("service worker caches only versioned static application assets", async () => {
  const worker = await readText("app/sw.js/route.ts");

  assert.match(worker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/pwa\/"\)/);
  assert.match(worker, /url\.pathname === "\/site\.webmanifest"/);
  assert.match(worker, /self\.clients\.claim\(\)/);
  assert.doesNotMatch(worker, /registration\.unregister/);
  assert.doesNotMatch(worker, /request\.mode === "navigate"/);
  assert.doesNotMatch(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("instance protection exposes only the non-sensitive PWA shell entry points", async () => {
  const proxy = await readText("proxy.ts");

  assert.match(proxy, /publicPwaShellPaths = new Set\(\["\/site\.webmanifest", "\/sw\.js"\]\)/);
  assert.match(proxy, /publicPwaShellPaths\.has\(pathname\)/);
  assert.doesNotMatch(proxy, /publicPwaShellPaths.*\/api\//);
});

async function readText(relativePath: string) {
  return await readFile(path.join(rootDir, relativePath), "utf8");
}

async function readPngDimensions(relativePath: string): Promise<readonly [number, number]> {
  const file = await readFile(path.join(rootDir, relativePath));
  assert.equal(file.subarray(1, 4).toString("ascii"), "PNG", `${relativePath} must be a PNG`);
  return [file.readUInt32BE(16), file.readUInt32BE(20)];
}

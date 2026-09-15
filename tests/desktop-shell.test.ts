import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

test("desktop capability grants only the native window interaction permissions", async () => {
  const capability = JSON.parse(
    await readFile(
      join(repoRoot, "apps/desktop/src-tauri/capabilities/default.json"),
      "utf8"
    )
  ) as { windows: string[]; permissions: string[] };

  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.permissions, [
    "core:window:allow-start-dragging",
    "core:window:allow-internal-toggle-maximize"
  ]);
});

test("desktop startup keeps the main window hidden until the splash gate is ready", async () => {
  const source = await readFile(join(repoRoot, "apps/desktop/src-tauri/src/main.rs"), "utf8");

  assert.match(source, /\.visible\(cfg!\(debug_assertions\)\)/);
  assert.match(source, /WebviewWindowBuilder::new\(app, "splash", WebviewUrl::App\("index\.html"\.into\(\)\)\)/);
  assert.match(source, /\.inner_size\(1040\.0, 576\.0\)/);
  assert.match(source, /\.decorations\(false\)/);
  assert.match(source, /\.center\(\)/);
  assert.match(source, /\.prevent_overflow_with_margin\(LogicalSize::new\(24\.0, 24\.0\)\)/);
  assert.match(source, /reveal_main_window\(&window\)/);
  assert.match(source, /const MAIN_NAVIGATION_TIMEOUT: Duration = Duration::from_secs\(20\)/);
  assert.match(source, /watch_main_navigation\(app\.clone\(\), window\.clone\(\)\)/);
});

test("macOS Dock activation restores the hidden main window after a native close", async () => {
  const source = await readFile(join(repoRoot, "apps/desktop/src-tauri/src/main.rs"), "utf8");

  assert.match(source, /RunEvent::Reopen\s*\{[\s\S]*has_visible_windows: false[\s\S]*\}\s*=> show_main_window_if_ready\(app\)/);
  assert.match(source, /fn show_main_window_if_ready\(app: &AppHandle\)/);
  assert.match(source, /api\.prevent_close\(\);\s*let _ = window\.hide\(\);/);
  assert.match(source, /let _ = window\.show\(\);\s*let _ = window\.set_focus\(\);/);
});

test("desktop shell uses native macOS overlay titlebar without replacing traffic lights", async () => {
  const source = await readFile(join(repoRoot, "apps/desktop/src-tauri/src/main.rs"), "utf8");
  const mainWindowSource = source.slice(
    source.indexOf("fn build_main_window"),
    source.indexOf("#[cfg(not(debug_assertions))]\nfn build_splash_window")
  );

  assert.match(mainWindowSource, /\.title_bar_style\(tauri::TitleBarStyle::Overlay\)/);
  assert.match(mainWindowSource, /\.hidden_title\(true\)/);
  assert.match(mainWindowSource, /\.traffic_light_position\(LogicalPosition::new\(16\.0, 18\.0\)\)/);
  assert.doesNotMatch(mainWindowSource, /\.decorations\(false\)/);
  assert.doesNotMatch(source, /tauri_plugin_opener::init\(\)/);
  assert.match(source, /tauri_plugin_opener::open_url\(parsed\.as_str\(\), None::<&str>\)/);
});

test("declared drag regions stay on shell surfaces instead of the sidebar controls", async () => {
  const [layout, nativeTitlebar, topbar, shell, onboarding, sidebar] = await Promise.all([
    readFile(join(repoRoot, "app/layout.tsx"), "utf8"),
    readFile(join(repoRoot, "components/desktop/native-titlebar.tsx"), "utf8"),
    readFile(join(repoRoot, "components/mission-control/mission-control-shell.topbar.tsx"), "utf8"),
    readFile(join(repoRoot, "components/mission-control/mission-control-shell.tsx"), "utf8"),
    readFile(join(repoRoot, "components/mission-control/openclaw-onboarding.tsx"), "utf8"),
    readFile(join(repoRoot, "components/mission-control/sidebar.tsx"), "utf8")
  ]);

  assert.match(layout, /DesktopNativeTitlebar/);
  assert.match(nativeTitlebar, /data-tauri-drag-region="deep"/);
  assert.match(nativeTitlebar, /agentos-native-drag-strip[\s\S]*fixed[\s\S]*z-20[\s\S]*h-8/);
  assert.match(topbar, /data-tauri-drag-region="deep"/);
  assert.match(topbar, /data-tauri-drag-region="false"/);
  assert.doesNotMatch(topbar, /agentos-native-drag-strip/);
  assert.match(shell, /data-tauri-drag-region="deep"[\s\S]*h-11/);
  assert.match(shell, /data-tauri-drag-region="deep"/);
  assert.match(shell, /const isFloatingHeaderHidden =/);
  assert.match(shell, /!isFloatingHeaderHidden/);
  assert.match(shell, /z-\[60\][\s\S]*lg:left-\[316px\][\s\S]*lg:left-\[80px\]/);
  assert.match(onboarding, /data-tauri-drag-region="deep"/);
  assert.match(sidebar, /agentos-sidebar-surface relative flex h-full min-h-0 flex-col px-4 py-5/);
  assert.match(sidebar, /agentos-sidebar-surface relative flex h-full w-full flex-col items-center/);
  assert.match(onboarding, /agentos-titlebar-surface/);
  assert.doesNotMatch(sidebar, /data-tauri-drag-region/);
});

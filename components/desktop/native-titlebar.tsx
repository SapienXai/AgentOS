export function DesktopNativeTitlebar() {
  return (
    <div
      aria-hidden="true"
      data-tauri-drag-region="deep"
      className="agentos-native-drag-strip pointer-events-auto fixed inset-x-0 top-0 z-20 hidden h-8 lg:block"
    />
  );
}

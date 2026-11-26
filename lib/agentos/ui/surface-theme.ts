export type SurfaceTheme = "light" | "dark";
export type ThemePreference = SurfaceTheme | "system";

export const themePreferenceStorageKey = "mission-control-surface-theme";
export const systemColorSchemeQuery = "(prefers-color-scheme: dark)";

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(themePreferenceStorageKey));
  } catch {
    return "system";
  }
}

export function applySurfaceTheme(theme: SurfaceTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

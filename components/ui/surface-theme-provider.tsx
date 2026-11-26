"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  applySurfaceTheme,
  parseThemePreference,
  readThemePreference,
  systemColorSchemeQuery,
  themePreferenceStorageKey,
  type SurfaceTheme,
  type ThemePreference
} from "@/lib/agentos/ui/surface-theme";

type SurfaceThemeContextValue = {
  surfaceTheme: SurfaceTheme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggleSurfaceTheme: () => void;
};

const SurfaceThemeContext = createContext<SurfaceThemeContextValue | null>(null);

export function SurfaceThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setPreference] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<SurfaceTheme | null>(null);
  const surfaceTheme = themePreference === "system" ? systemTheme ?? "dark" : themePreference;

  useEffect(() => {
    const media = window.matchMedia(systemColorSchemeQuery);

    function syncSystemTheme() {
      setSystemTheme(media.matches ? "dark" : "light");
    }

    function syncStoredPreference(event: StorageEvent) {
      if (event.storageArea === window.localStorage && (event.key === themePreferenceStorageKey || event.key === null)) {
        setPreference(parseThemePreference(event.newValue));
      }
    }

    queueMicrotask(() => {
      setPreference(readThemePreference());
      syncSystemTheme();
    });
    media.addEventListener("change", syncSystemTheme);
    window.addEventListener("storage", syncStoredPreference);
    return () => {
      media.removeEventListener("change", syncSystemTheme);
      window.removeEventListener("storage", syncStoredPreference);
    };
  }, []);

  useEffect(() => {
    if (systemTheme === null) return;

    applySurfaceTheme(surfaceTheme);
  }, [surfaceTheme, systemTheme]);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    setPreference(preference);
    try {
      if (preference === "system") {
        window.localStorage.removeItem(themePreferenceStorageKey);
      } else {
        window.localStorage.setItem(themePreferenceStorageKey, preference);
      }
    } catch {
      // The choice still applies for this page.
    }
  }, []);

  const toggleSurfaceTheme = useCallback(() => {
    const next = surfaceTheme === "light" ? "dark" : "light";
    setThemePreference(next === systemTheme ? "system" : next);
  }, [setThemePreference, surfaceTheme, systemTheme]);

  const value = useMemo(() => ({
    surfaceTheme,
    themePreference,
    setThemePreference,
    toggleSurfaceTheme
  }), [surfaceTheme, themePreference, setThemePreference, toggleSurfaceTheme]);

  return <SurfaceThemeContext.Provider value={value}>{children}</SurfaceThemeContext.Provider>;
}

export function useSurfaceTheme() {
  const value = useContext(SurfaceThemeContext);
  if (!value) throw new Error("useSurfaceTheme requires SurfaceThemeProvider");
  return value;
}

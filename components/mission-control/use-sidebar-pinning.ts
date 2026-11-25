"use client";

import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

export const sidebarPinnedStorageKey = "agentos.sidebar.pinned";

const listeners = new Set<() => void>();
let memoryPinned: boolean | null = null;

function readSidebarPinned(defaultPinned: boolean) {
  try {
    const preference = window.localStorage.getItem(sidebarPinnedStorageKey);
    memoryPinned = preference === null ? null : preference === "true";
    return memoryPinned ?? defaultPinned;
  } catch {
    return memoryPinned ?? defaultPinned;
  }
}

function subscribe(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === sidebarPinnedStorageKey) {
      memoryPinned = event.newValue === null ? null : event.newValue === "true";
      listener();
    }
  };

  listeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useSidebarPinning(defaultPinned = false) {
  const readPreference = useCallback(() => readSidebarPinned(defaultPinned), [defaultPinned]);
  const isSidebarPinned = useSyncExternalStore(subscribe, readPreference, () => defaultPinned);
  const setIsSidebarPinned = useCallback((action: SetStateAction<boolean>) => {
    const nextPinned = typeof action === "function" ? action(readPreference()) : action;
    memoryPinned = nextPinned;

    try {
      window.localStorage.setItem(sidebarPinnedStorageKey, String(nextPinned));
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
    listeners.forEach((listener) => listener());
  }, [readPreference]);

  return { isSidebarPinned, setIsSidebarPinned };
}

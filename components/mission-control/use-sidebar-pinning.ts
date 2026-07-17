"use client";

import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

export const sidebarPinnedStorageKey = "agentos.sidebar.pinned";

const listeners = new Set<() => void>();
let memoryPinned = false;

function readSidebarPinned() {
  try {
    memoryPinned = window.localStorage.getItem(sidebarPinnedStorageKey) === "true";
    return memoryPinned;
  } catch {
    return memoryPinned;
  }
}

function subscribe(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === sidebarPinnedStorageKey) {
      memoryPinned = event.newValue === "true";
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

export function useSidebarPinning() {
  const isSidebarPinned = useSyncExternalStore(subscribe, readSidebarPinned, () => false);
  const setIsSidebarPinned = useCallback((action: SetStateAction<boolean>) => {
    const nextPinned = typeof action === "function" ? action(readSidebarPinned()) : action;
    memoryPinned = nextPinned;

    try {
      window.localStorage.setItem(sidebarPinnedStorageKey, String(nextPinned));
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return { isSidebarPinned, setIsSidebarPinned };
}

"use client";

import { useCallback, useMemo, useState } from "react";

import type {
  ContextEngineFile,
  ContextEngineFileStatus
} from "@/lib/openclaw/context-engine-types";

export function useContextEngineDraft(files: ContextEngineFile[]) {
  const [draftEnabledByPath, setDraftEnabledByPath] = useState<Record<string, boolean>>({});
  const displayFiles = useMemo(
    () => applyContextEngineDraftState(files, draftEnabledByPath),
    [draftEnabledByPath, files]
  );
  const hasContextChanges = useMemo(
    () => displayFiles.some((file) => file.enabled !== file.savedEnabled),
    [displayFiles]
  );
  const replaceDraftFromFiles = useCallback(
    (nextFiles: ContextEngineFile[], source: "enabled" | "saved" = "enabled") => {
      setDraftEnabledByPath(
        Object.fromEntries(nextFiles.map((file) => [file.path, source === "saved" ? file.savedEnabled : file.enabled]))
      );
    },
    []
  );
  const toggleDraftFile = useCallback((file: ContextEngineFile) => {
    if (!file.canToggle) {
      return;
    }

    setDraftEnabledByPath((current) => ({
      ...current,
      [file.path]: !Boolean(current[file.path] ?? file.enabled)
    }));
  }, []);

  return {
    draftEnabledByPath,
    setDraftEnabledByPath,
    displayFiles,
    hasContextChanges,
    replaceDraftFromFiles,
    toggleDraftFile
  };
}

export function applyContextEngineDraftState(
  files: ContextEngineFile[],
  draftEnabledByPath: Record<string, boolean>
) {
  return files.map((file) => {
    const enabled = Boolean(draftEnabledByPath[file.path] ?? file.enabled);
    const status = resolveDraftStatus(file, enabled);

    return {
      ...file,
      enabled,
      status,
      injectedTokens: enabled ? file.injectedTokens : 0,
      statusReason: status === "disabled" ? "This file is excluded in the unsaved Context Engine draft." : file.statusReason
    };
  });
}

function resolveDraftStatus(file: ContextEngineFile, enabled: boolean): ContextEngineFileStatus {
  if (!file.exists) {
    return "missing";
  }

  if (!enabled) {
    return "disabled";
  }

  return file.status === "disabled" ? "enabled" : file.status;
}

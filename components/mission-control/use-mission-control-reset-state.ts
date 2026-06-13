"use client";

import { useCallback, useState } from "react";

import type { ResetPreview, ResetTarget } from "@/lib/agentos/contracts";

export type MissionControlResetRunState = "idle" | "running" | "success" | "error";
export type MissionControlResetPreviewState = "idle" | "loading" | "ready" | "error";

export function useMissionControlResetState() {
  const [resetDialogTarget, setResetDialogTarget] = useState<ResetTarget | null>(null);
  const [resetPreviewState, setResetPreviewState] = useState<MissionControlResetPreviewState>("idle");
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [resetPreviewError, setResetPreviewError] = useState<string | null>(null);
  const [resetRunState, setResetRunState] = useState<MissionControlResetRunState>("idle");
  const [resetStatusMessage, setResetStatusMessage] = useState<string | null>(null);
  const [resetResultMessage, setResetResultMessage] = useState<string | null>(null);
  const [resetBackgroundLogPath, setResetBackgroundLogPath] = useState<string | null>(null);
  const [resetLog, setResetLog] = useState("");
  const [resetConfirmText, setResetConfirmText] = useState("");

  const resetResetDialogState = useCallback(() => {
    setResetPreviewState("idle");
    setResetPreview(null);
    setResetPreviewError(null);
    setResetRunState("idle");
    setResetStatusMessage(null);
    setResetResultMessage(null);
    setResetBackgroundLogPath(null);
    setResetLog("");
    setResetConfirmText("");
  }, []);

  return {
    resetDialogTarget,
    setResetDialogTarget,
    resetPreviewState,
    setResetPreviewState,
    resetPreview,
    setResetPreview,
    resetPreviewError,
    setResetPreviewError,
    resetRunState,
    setResetRunState,
    resetStatusMessage,
    setResetStatusMessage,
    resetResultMessage,
    setResetResultMessage,
    resetBackgroundLogPath,
    setResetBackgroundLogPath,
    resetLog,
    setResetLog,
    resetConfirmText,
    setResetConfirmText,
    resetResetDialogState
  };
}

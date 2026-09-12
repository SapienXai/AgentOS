export const workspaceCreationMinimizedRunStorageKey = "agentos:workspace-creation:minimized-run";
export const workspaceCreationActivityChangeEvent = "agentos:workspace-creation-activity-change";

function notifyWorkspaceCreationActivityChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(workspaceCreationActivityChangeEvent));
  }
}

export function readWorkspaceCreationMinimizedRunId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(workspaceCreationMinimizedRunStorageKey)?.trim() ?? "";
    return value.length > 0 && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export function persistWorkspaceCreationMinimizedRun(runId: string) {
  if (typeof window === "undefined" || !runId.trim()) {
    return;
  }

  try {
    window.localStorage.setItem(workspaceCreationMinimizedRunStorageKey, runId.trim());
    notifyWorkspaceCreationActivityChange();
  } catch {
    // A blocked browser storage surface must not interrupt workspace creation.
  }
}

export function clearWorkspaceCreationMinimizedRun() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(workspaceCreationMinimizedRunStorageKey);
    notifyWorkspaceCreationActivityChange();
  } catch {
    // A blocked browser storage surface must not interrupt workspace creation.
  }
}

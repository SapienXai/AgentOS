"use client";

import { useCallback, useEffect, useState } from "react";
import { BookmarkPlus, Check, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SelectionList } from "@/components/workforce/selection-list";
import { documentLabel, isAssignableDocument, knowledgeFormatFromPath, MAX_KNOWLEDGE_ASSIGNMENT_CHANGES, type KnowledgeAssignmentChange } from "@/lib/agentos/domains/knowledge-import-formats";
import type { WorkspaceManagedFile } from "@/lib/openclaw/workspace-file-types";

export function EmployeeDocuments({ workspaceId, employeeId, path }: {
  workspaceId: string;
  employeeId: string;
  path?: string;
}) {
  const [files, setFiles] = useState<WorkspaceManagedFile[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<string[] | null>(null);
  const base = "/api/workspaces/" + encodeURIComponent(workspaceId);
  const endpoint = base + "/knowledge/assignments";
  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint + "?employee=" + encodeURIComponent(employeeId), { signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not read assigned documents.");
    setAssigned(data.paths);
    setLoaded(true);
  }, [employeeId, endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoaded(false);
    setError("");
    setStatus("");
    const listing = path ? Promise.resolve() : fetch(base + "/files", { signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not read workspace documents.");
        setFiles((data.files as WorkspaceManagedFile[]).filter(file => file.exists && isAssignableDocument(file.path)));
      });
    void Promise.all([listing, reload(signal)]).catch(failure => {
      if (!signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [base, path, reload]);

  async function update(changes: KnowledgeAssignmentChange[], key: string) {
    if (busy) return;
    setBusy(key);
    setError("");
    setStatus("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: employeeId, changes })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update employee context.");
      setAssigned(data.paths);
      setDraft(key === "batch" ? data.paths : null);
      setStatus(data.status === "pending" ? "OpenClaw is applying this change. Refresh assignments to check it." :
        "Memory search assignments saved.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update employee context.");
    } finally {
      setBusy(null);
    }
  }

  const rows = path ? [{ path, stale: false }] : [
    ...files.map(file => ({ path: file.path, stale: false })),
    ...assigned.filter(item => !files.some(file => file.path === item)).map(path => ({ path, stale: true }))
  ];
  const changes = draft ? [...new Set([...draft, ...assigned])]
    .filter(path => draft.includes(path) !== assigned.includes(path))
    .map(path => ({ path, selected: draft.includes(path) })) : [];
  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : null}
      {loaded && !path && rows.length > 0 && <details onToggle={event => setDraft(event.currentTarget.open ? assigned : null)}>
        <summary className="min-h-9 cursor-pointer text-sm font-semibold">Manage document selections</summary>
        {draft && <div className="space-y-3 pb-3">
          <SelectionList label="Memory search sources" selected={draft} onChange={setDraft} disabled={!!busy}
            empty="No documents are available."
            items={rows.map(item => ({ id: item.path, label: documentLabel(item.path), unavailable: item.stale,
              detail: item.stale ? "Missing source · Remove from search" : `${knowledgeFormatFromPath(item.path)?.toUpperCase() ?? "Document"} · Shared workspace` }))} />
          {changes.length > MAX_KNOWLEDGE_ASSIGNMENT_CHANGES && <p role="alert" className="text-sm">Save up to 32 changes at a time.</p>}
          <Button type="button" size="sm" disabled={!changes.length || !!busy || changes.length > MAX_KNOWLEDGE_ASSIGNMENT_CHANGES}
            onClick={() => void update(changes, "batch")}>{busy === "batch" ? "Saving…" : "Save assignments"}</Button>
        </div>}
      </details>}
      {loaded && !draft ? (
        <ul className="divide-y divide-border/80">
          {rows.map(file => {
            const selected = assigned.includes(file.path);
            const format = knowledgeFormatFromPath(file.path)?.toUpperCase();
            return <li key={file.path} className="workforce-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5">
              <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
              <div className="min-w-0"><p className="break-words text-sm font-medium capitalize">{documentLabel(file.path)}</p>
                <p className="text-xs text-muted-foreground">{format ? format + " · " : ""}{file.stale ? "Source missing · remove this assignment" : selected ? "Assigned · retrieval unverified" : "Shared workspace document"}</p></div>
              <Button type="button" size="sm" variant={selected ? "ghost" : "secondary"}
                disabled={!!busy} onClick={() => void update([{ path: file.path, selected: !selected }], file.path)}
                aria-label={(selected ? "Remove assignment for " : "Assign ") + documentLabel(file.path) + (format ? ` (${format})` : "")}>
                {selected ? <Check aria-hidden="true" className="mr-1.5 size-3.5" /> : <BookmarkPlus aria-hidden="true" className="mr-1.5 size-3.5" />}
                {busy === file.path ? "Saving…" : selected ? "Remove" : "Assign"}
              </Button>
            </li>;
          })}
        </ul>
      ) : !loaded && !error ? <p role="status" className="text-sm text-muted-foreground">Checking document assignments…</p> : null}
      {loaded && !rows.length ? <p className="text-sm text-muted-foreground">Add a document or note to the workspace to assign it here.</p> : null}
      {(status || error) && <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => {
        setError(""); setStatus(""); void reload().catch(failure => setError(failure.message));
      }}>Refresh assignments</Button>}
    </div>
  );
}

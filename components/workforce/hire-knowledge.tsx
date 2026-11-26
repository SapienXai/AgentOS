"use client";

import { useEffect, useState } from "react";
import { BookOpen, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SelectionList } from "@/components/workforce/selection-list";
import { KnowledgeImportDialog } from "@/components/workforce/knowledge-import-dialog";
import { documentLabel, isAssignableDocument, knowledgeFormatFromPath, MAX_KNOWLEDGE_ASSIGNMENT_CHANGES } from "@/lib/agentos/domains/knowledge-import-formats";
import type { WorkspaceManagedFile } from "@/lib/openclaw/workspace-file-types";

export function HireKnowledge({ workspaceId, surfaceTheme, selected, onChange }: {
  workspaceId: string;
  surfaceTheme: "light" | "dark";
  selected: string[];
  onChange: (paths: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<WorkspaceManagedFile[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (!expanded || !workspaceId) return;
    const abort = new AbortController();
    void fetch("/api/workspaces/" + encodeURIComponent(workspaceId) + "/files", { signal: abort.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load workspace documents.");
        setFiles((data.files as WorkspaceManagedFile[]).filter(file => file.exists && isAssignableDocument(file.path)));
        setError("");
      })
      .catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [workspaceId, expanded, request]);

  return (
    <details className="border-b border-border/75 py-3" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer list-none text-sm font-semibold">
        <span className="flex min-h-9 items-center gap-2"><BookOpen aria-hidden="true" className="size-4 text-primary" />Knowledge<span className="ml-auto text-xs font-normal text-muted-foreground">{selected.length ? selected.length + " selected" : "Workspace defaults"}</span></span>
      </summary>
      <div className="space-y-3 py-2">
        <p className="text-xs leading-5 text-muted-foreground">This employee inherits workspace context. Choose sources for their memory search after creation. Shared file access follows the workspace policy.</p>
        {workspaceId ? <>
          {files && <SelectionList label="Documents" selected={selected} onChange={onChange}
            limit={MAX_KNOWLEDGE_ASSIGNMENT_CHANGES} empty="Add a document to give this employee company knowledge."
            items={files.map(file => ({ id: file.path, label: documentLabel(file.path), detail: `${knowledgeFormatFromPath(file.path)?.toUpperCase() ?? "Document"} · Shared workspace` }))} />}
          {!files && !error ? <p role="status" className="text-xs text-muted-foreground">Checking workspace documents…</p> : null}
          <Button variant="secondary" size="sm" type="button" onClick={() => setImporting(true)}>
            <Plus aria-hidden="true" className="mr-1.5 size-4" /> Add knowledge
          </Button>
        </> : <p className="text-sm text-muted-foreground">Choose a workspace to add a document.</p>}
        {error ? <div><p role="alert" className="text-xs text-destructive">{error}</p>
          <Button variant="ghost" size="sm" type="button" onClick={() => setRequest(value => value + 1)}>Retry</Button>
        </div> : null}
      </div>
      {importing ? <KnowledgeImportDialog workspaceId={workspaceId} surfaceTheme={surfaceTheme}
        onClose={() => setImporting(false)} onImported={results => {
          setImporting(false); setRequest(value => value + 1);
          const imported = results.map(result => result.file).filter(file => isAssignableDocument(file.path));
          setFiles(current => [...new Map([...(current ?? []), ...imported].map(file => [file.path, file])).values()]);
          onChange([...new Set([...selected, ...imported.map(file => file.path)])].slice(0, MAX_KNOWLEDGE_ASSIGNMENT_CHANGES));
        }} /> : null}
    </details>
  );
}

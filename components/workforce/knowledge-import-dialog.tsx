"use client";

import { useState, type FormEvent } from "react";
import { FileUp, Link2, NotebookPen } from "lucide-react";

import { MissionControlDialogShell } from "@/components/mission-control/mission-control-dialog-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_IMPORT_ACCEPT, KNOWLEDGE_IMPORT_INPUT_BYTES } from "@/lib/agentos/domains/knowledge-import-formats";
import type { WorkspaceManagedFile } from "@/lib/openclaw/workspace-file-types";
import { cn } from "@/lib/utils";

const sourceKinds = [
  { id: "document", label: "Document", description: "Import a file", icon: FileUp },
  { id: "note", label: "Write a note", description: "Capture a fact or process", icon: NotebookPen },
  { id: "reference", label: "Website link", description: "Save a reference", icon: Link2 }
] as const;

export function KnowledgeImportDialog({ workspaceId, surfaceTheme, onClose, onImported }: {
  workspaceId: string;
  surfaceTheme: "dark" | "light";
  onClose: () => void;
  onImported: (result: { file: WorkspaceManagedFile; title: string; kind: string }) => void;
}) {
  const [kind, setKind] = useState<typeof sourceKinds[number]["id"]>("document");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const input = new FormData(event.currentTarget);
    const file = input.get("document");
    if (kind === "document" && (!(file instanceof File) || !file.size || file.size > KNOWLEDGE_IMPORT_INPUT_BYTES)) {
      setError("Choose a document between 1 byte and 4 MiB.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/" + encodeURIComponent(workspaceId) + "/knowledge", {
        method: "POST",
        body: kind === "document" ? input : JSON.stringify({ kind, title: input.get("title"), ...(
          kind === "note" ? { content: input.get("content") } : { url: input.get("url") }
        ) }),
        headers: kind === "document" ? undefined : { "Content-Type": "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The source could not be added.");
      onImported(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The source could not be added.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <MissionControlDialogShell open onOpenChange={open => { if (!open && !working) onClose(); }}
      surfaceTheme={surfaceTheme} title="Add knowledge" description="Add reference material to the selected workspace."
      contentClassName={cn("sm:h-auto sm:w-[min(92vw,640px)]", surfaceTheme === "light" ? "workforce-setup-card workforce-setup-light" : "workforce-setup-card")}
      bodyClassName="px-5 py-5 sm:px-7" disableOutsideDismiss={working}>
      <form className="space-y-5" onSubmit={save}>
        <fieldset className="grid grid-cols-3 gap-2" disabled={working}>
          <legend className="sr-only">Source type</legend>
          {sourceKinds.map(option => (
            <label key={option.id} className="relative min-w-0 cursor-pointer">
              <input type="radio" name="source-kind" value={option.id} checked={kind === option.id}
                onChange={() => { setKind(option.id); setError(""); }}
                className="peer sr-only" />
              <span className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-border px-2.5 py-2.5 text-center sm:min-h-24 peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring sm:px-3">
                <option.icon aria-hidden="true" className="size-4" />
                <span className="text-sm font-medium">{option.label}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {kind === "document" ? (
          <div className="space-y-2">
            <Label htmlFor="workforce-source-file">Choose a document</Label>
            <Input id="workforce-source-file" name="document" type="file" accept={KNOWLEDGE_IMPORT_ACCEPT} required disabled={working} className="h-11 min-w-0 py-2 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">PDF, Word, Excel, CSV, text, Markdown or JSON. Up to 4 MiB with up to 512 KiB of extracted text.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2"><Label htmlFor="workforce-source-title">Name</Label>
              <Input id="workforce-source-title" name="title" maxLength={120} required disabled={working} className="min-h-11 text-base sm:text-sm" /></div>
            {kind === "note" ? <div className="space-y-2"><Label htmlFor="workforce-source-note">Note</Label>
              <Textarea id="workforce-source-note" name="content" rows={5} required disabled={working} className="text-base sm:text-sm" /></div> :
              <div className="space-y-2"><Label htmlFor="workforce-source-url">Website address</Label>
                <Input id="workforce-source-url" name="url" type="url" maxLength={4096} required disabled={working} className="min-h-11 text-base sm:text-sm" />
                <p className="text-xs text-muted-foreground">Saves a link. The site’s contents stay at the source.</p>
              </div>}
          </>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" disabled={working} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={working}>{working ? "Adding source…" : "Add to workspace"}</Button>
        </div>
      </form>
    </MissionControlDialogShell>
  );
}

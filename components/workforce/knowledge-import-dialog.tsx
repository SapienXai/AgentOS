"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, FileUp, Globe2, Link2, NotebookPen } from "lucide-react";

import { MissionControlDialogShell } from "@/components/mission-control/mission-control-dialog-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_IMPORT_ACCEPT, KNOWLEDGE_IMPORT_INPUT_BYTES } from "@/lib/agentos/domains/knowledge-import-formats";
import type { WorkspaceManagedFile } from "@/lib/openclaw/workspace-file-types";
import { cn } from "@/lib/utils";

const sourceKinds = [
  { id: "document", label: "Documents", icon: FileUp },
  { id: "note", label: "Note", icon: NotebookPen },
  { id: "reference", label: "Save link", icon: Link2 },
  { id: "web", label: "Import webpage", icon: Globe2 }
] as const;
const maxFiles = 12;
type ImportResult = { file: WorkspaceManagedFile; title: string; kind: string; disposition?: "added" | "already-saved"; originalFilename?: string };
type FileRow = { file: File; stage: "ready" | "importing" | "saved" | "failed"; result?: ImportResult; error?: string };
type WebPreview = { title: string; url: string; text: string; digest: string };

export function KnowledgeImportDialog({ workspaceId, surfaceTheme, onClose, onImported, initialWebsite }: {
  workspaceId: string;
  initialWebsite?: string;
  surfaceTheme: "dark" | "light";
  onClose: () => void;
  onImported: (results: ImportResult[]) => void;
}) {
  const [kind, setKind] = useState<typeof sourceKinds[number]["id"]>(initialWebsite ? "web" : "document");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<FileRow[]>([]);
  const [preview, setPreview] = useState<WebPreview | null>(null);
  const active = useRef<AbortController | null>(null);
  const formId = useId();
  const saved = rows.flatMap(row => row.result ? [row.result] : []);
  const finished = kind === "document" && rows.length > 0 && saved.length === rows.length;
  useEffect(() => () => active.current?.abort(), []);

  async function request(body: FormData | Record<string, unknown>, signal: AbortSignal) {
    const multipart = body instanceof FormData;
    const response = await fetch("/api/workspaces/" + encodeURIComponent(workspaceId) + "/knowledge", {
      method: "POST", signal,
      body: multipart ? body : JSON.stringify(body),
      headers: multipart ? undefined : { "Content-Type": "application/json" }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The source could not be added.");
    return result;
  }

  function finish() {
    if (saved.length) onImported([...new Map(saved.map(result => [result.file.path, result])).values()]);
    else onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || finished) return;
    const input = new FormData(event.currentTarget);
    const controller = new AbortController();
    active.current = controller;
    setWorking(true);
    setError("");
    try {
      if (kind === "document") {
        if (!rows.length) throw new Error("Choose at least one document.");
        const complete: ImportResult[] = [];
        // Each file has its own bounded request and stable server-side identity.
        for (const [index, row] of rows.entries()) {
          if (controller.signal.aborted) break;
          if (row.result) { complete.push(row.result); continue; }
          setRows(current => current.map((entry, i) => i === index ? { ...entry, stage: "importing", error: undefined } : entry));
          try {
            if (row.file.size < 1 || row.file.size > KNOWLEDGE_IMPORT_INPUT_BYTES) {
              throw new Error("Choose a file between 1 byte and 4 MiB.");
            }
            const body = new FormData();
            body.set("document", row.file);
            const result: ImportResult = { ...await request(body, controller.signal), originalFilename: row.file.name };
            complete.push(result);
            setRows(current => current.map((entry, i) => i === index ? { ...entry, stage: "saved", result } : entry));
          } catch (failure) {
            const message = controller.signal.aborted ? "Stopped. Retry to verify or add this file." :
              failure instanceof Error ? failure.message : "Could not import this file.";
            setRows(current => current.map((entry, i) => i === index ? { ...entry, stage: "failed", error: message } : entry));
          }
        }
        if (rows.length === 1 && complete.length === 1) onImported(complete);
      } else if (kind === "web" && !preview) {
        const result = await request({ kind: "web-preview", url: input.get("url") }, controller.signal);
        setPreview(result.preview);
      } else {
        try {
          const result = await request(kind === "web"
            ? { kind, url: input.get("url"), digest: preview?.digest }
            : { kind, title: input.get("title"), ...(kind === "note" ? { content: input.get("content") } : { url: input.get("url") }) },
          controller.signal);
          onImported([result]);
        } catch (failure) {
          if (kind === "web") setPreview(null);
          throw failure;
        }
      }
    } catch (failure) {
      setError(controller.signal.aborted ? "Stopped. You can try again." : failure instanceof Error ? failure.message : "The source could not be added.");
    } finally {
      active.current = null;
      setWorking(false);
    }
  }

  return (
    <MissionControlDialogShell open onOpenChange={open => { if (!open && !working) finish(); }}
      surfaceTheme={surfaceTheme} title={initialWebsite ? "Refresh webpage" : "Add knowledge"}
      description={initialWebsite ? "Review the latest text. A changed page is saved as a new document and existing assignments stay with the original." : "Give your team material they can refer to."}
      contentClassName={cn("sm:h-[min(660px,calc(100dvh-4rem))] sm:w-[min(92vw,660px)]", surfaceTheme === "light" ? "workforce-setup-card workforce-setup-light" : "workforce-setup-card")}
      bodyClassName="px-5 py-5 sm:px-7" disableOutsideDismiss={working}
      footer={<>
        <Button type="button" variant="ghost" onClick={() => working ? active.current?.abort() : finish()}>
          {working ? "Stop" : saved.length ? "Done" : "Cancel"}
        </Button>
        {!finished && <Button type="submit" form={formId} disabled={working}>
          {working ? "Preparing…" : kind === "web" && !preview ? "Preview webpage" : initialWebsite ? "Save reviewed copy" : rows.some(row => row.stage === "failed") && kind === "document" ? "Retry remaining" : "Add to workspace"}
        </Button>}
      </>}>
      <form id={formId} className="space-y-5" onSubmit={save}>
        {!initialWebsite && <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4" disabled={working || saved.length > 0}>
          <legend className="sr-only">Source type</legend>
          {sourceKinds.map(option => (
            <label key={option.id} className="relative min-w-0 cursor-pointer">
              <input type="radio" name="source-kind" value={option.id} checked={kind === option.id}
                onChange={() => { setKind(option.id); setError(""); setPreview(null); }} className="peer sr-only" />
              <span className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border px-2 py-2 text-center text-sm peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                <option.icon aria-hidden="true" className="size-4" />{option.label}
              </span>
            </label>
          ))}
        </fieldset>}
        {kind === "document" ? (
          <div className="space-y-3">
            <Label htmlFor="workforce-source-file">Choose documents</Label>
            <Input id="workforce-source-file" name="document" type="file" multiple accept={KNOWLEDGE_IMPORT_ACCEPT} disabled={working || saved.length > 0}
              onChange={event => {
                const files = Array.from(event.target.files ?? []);
                setError(files.length > maxFiles ? "Choose up to 12 documents at a time." : "");
                setRows(files.length <= maxFiles ? files.map(file => ({ file, stage: "ready" })) : []);
              }}
              className="h-11 min-w-0 py-2 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">PDF, Word, Excel and text documents, including Markdown, CSV and JSON. Up to 4 MiB per file and 512 KiB of extracted text.</p>
            {rows.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border" aria-live="polite">
              {rows.map((row, index) => <li key={row.file.name + ":" + index} className="flex min-h-12 items-start gap-3 px-3 py-2">
                {row.stage === "saved" ? <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> :
                  <FileUp aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0"><p className="break-words text-sm font-medium">{row.file.name}</p>
                  <p className={cn("text-xs", row.error ? "text-destructive" : "text-muted-foreground")}>{row.error ??
                    ({ ready: "Ready to import", importing: "Preparing document…", saved: row.result?.disposition === "already-saved" ? "Already in workspace" : "Saved to workspace", failed: "Try again" })[row.stage]}</p>
                </div>
              </li>)}
            </ul>}
          </div>
        ) : (
          <>
            {kind !== "web" && <div className="space-y-2"><Label htmlFor="workforce-source-title">Name</Label>
              <Input id="workforce-source-title" name="title" maxLength={120} required disabled={working} className="min-h-11 text-base sm:text-sm" /></div>}
            {kind === "note" ? <div className="space-y-2"><Label htmlFor="workforce-source-note">Note</Label>
              <Textarea id="workforce-source-note" name="content" rows={5} required disabled={working} className="text-base sm:text-sm" /></div> :
              <div className="space-y-2"><Label htmlFor="workforce-source-url">Website address</Label>
                <Input id="workforce-source-url" name="url" type="url" defaultValue={initialWebsite} maxLength={4096} required readOnly={working}
                  onChange={() => setPreview(null)} className="min-h-11 text-base sm:text-sm" />
                <p className="text-xs text-muted-foreground">{kind === "web" ? "Review text from one public page before adding it." : "Saves a link. The site’s contents stay at the source."}</p>
              </div>}
            {kind === "web" && preview && <section aria-label="Webpage preview" className="workforce-panel space-y-3 p-4">
              <h3 className="font-semibold">{preview.title}</h3>
              <p className="break-all text-xs text-muted-foreground">{preview.url}</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{preview.text}</p>
            </section>}
          </>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </form>
    </MissionControlDialogShell>
  );
}

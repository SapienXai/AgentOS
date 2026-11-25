"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, FileText, Link2, Plus, Upload } from "lucide-react";

import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FileView } from "@/components/operations/operations-data";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { WORKSPACE_MANAGED_FILE_MAX_BYTES } from "@/lib/openclaw/workspace-file-types";

type KnowledgeGroup = "profile" | "guidelines" | "documents" | "sources" | "memory";
const managedLabels: Record<string, string> = {
  "docs/brief.md": "Company brief",
  "docs/architecture.md": "How the workspace is organized",
  "docs/guidelines.md": "Working guidelines",
  "MEMORY.md": "Shared memory",
  "memory/decisions.md": "Decision history",
  "memory/blueprint.md": "Workspace plan"
};

function groupFor(file: FileView): KnowledgeGroup | null {
  const { relativePath, category } = file;
  if (!file.source?.exists || relativePath.startsWith("agents/")) return null;
  if (relativePath === "docs/brief.md") return "profile";
  if (/^docs\/(?:working-)?guidelines(?:-[a-f0-9]{8})?\.md$/.test(relativePath)) return "guidelines";
  if (relativePath.startsWith("docs/sources/")) return "sources";
  if (relativePath.startsWith("docs/")) return "documents";
  if (category === "memory") return "memory";
  return null;
}

function documentTitle(file: FileView) {
  return managedLabels[file.relativePath] ??
    file.name.replace(/-[a-f0-9]{8}(?=\.(?:md|json)$)/, "").replace(/\.(?:md|json)$/, "").replaceAll("-", " ");
}

export function CompanyKnowledge({ files, employees, workspaceId, loading, onOpen, onChanged }: {
  files: FileView[];
  employees: MissionControlSnapshot["agents"];
  workspaceId: string | null;
  loading: boolean;
  onOpen: (file: FileView) => void;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<"file" | "source" | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function addKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !dialog || working) return;
    const input = new FormData(event.currentTarget);
    setWorking(true);
    setError("");
    try {
      let name: string, content: string, folder: string, extension: string;
      if (dialog === "file") {
        const file = input.get("document");
        if (!(file instanceof File) || !file.size || !/\.(md|json)$/i.test(file.name)) throw new Error("Choose a Markdown or JSON document.");
        if (file.size > WORKSPACE_MANAGED_FILE_MAX_BYTES) throw new Error("Choose a file 512 KB or smaller.");
        name = file.name.replace(/\.(md|json)$/i, "");
        extension = file.name.toLowerCase().endsWith(".json") ? "json" : "md";
        content = await file.text();
        folder = "docs";
      } else {
        const url = new URL(String(input.get("url") ?? ""));
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter an HTTP or HTTPS link without credentials.");
        name = String(input.get("title") ?? "").trim();
        content = `# ${name}\n\n<${url.href}>\n`;
        extension = "md";
        folder = "docs/sources";
      }
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "document";
      const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, "0");
      const path = `${folder}/${slug}-${suffix}.${extension}`;
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "OpenClaw could not save this document.");
      }
      setMessage(dialog === "file" ? "Document added to the workspace." : "Reference link saved to the workspace.");
      setDialog(null);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save to the workspace.");
    } finally {
      setWorking(false);
    }
  }

  function rows(id: KnowledgeGroup, empty: ReactNode) {
    const matching = files.filter(file => groupFor(file) === id);
    return matching.length ? (
      <ul className="divide-y divide-border/65">
        {matching.map(file => (
          <li key={file.id}>
            <button onClick={() => onOpen(file)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/70">
              {id === "sources" ? <Link2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium capitalize">{documentTitle(file)}</span>
                <span className="text-xs text-muted-foreground">{file.workspaceName} · {id === "sources" ? "Saved reference" : "Workspace file"}</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    ) : <p className="text-sm leading-6 text-muted-foreground">{loading ? "Loading…" : empty}</p>;
  }

  return (
    <div className="workforce-detail-grid space-y-5" aria-busy={loading}>
      <p role="status" className={message ? "text-sm text-foreground" : "sr-only"}>{message}</p>
      <div className="workforce-detail-grid-inner">
        <section className="workforce-panel px-5 py-5 sm:p-6">
          <BookOpen aria-hidden="true" className="mb-3 size-5 text-primary" />
          <h2 className="workforce-section-title">Company profile</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">What the company does and what the team is here to accomplish.</p>
          {rows("profile", "A company brief appears here when it’s available in the workspace.")}
        </section>
        <section className="workforce-panel p-5 sm:p-6">
          <h2 className="workforce-section-title">Working guidelines</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">Reference material for how the company works.</p>
          {rows("guidelines", "No dedicated guidelines document is available. Upload a guideline to share it with the company.")}
        </section>
      </div>
      <section className="workforce-panel space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="workforce-section-title">Shared documents</h2>
          <Button variant="secondary" disabled={!workspaceId} onClick={() => { setError(""); setDialog("file"); }}>
            <Upload aria-hidden="true" className="mr-2 size-4" /> Upload document
          </Button>
        </div>
        {rows("documents", workspaceId ? "Share a Markdown or JSON document with this workspace." : "Choose a workspace to upload shared documents.")}
      </section>
      <div className="workforce-detail-grid-inner">
        <section className="workforce-panel space-y-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="workforce-section-title">Knowledge sources</h2>
            <Button variant="ghost" disabled={!workspaceId} onClick={() => { setError(""); setDialog("source"); }}>
              <Plus aria-hidden="true" className="mr-1.5 size-4" /> Add reference
            </Button>
          </div>
          {rows("sources", "Save links that the team can follow from a workspace reference.")}
        </section>
        <section className="workforce-panel space-y-3 p-5 sm:p-6">
          <h2 className="workforce-section-title">Workspace memory</h2>
          {rows("memory", "No native workspace memory files are available.")}
        </section>
      </div>
      <section className="space-y-3">
        <h2 className="workforce-section-title">Employee knowledge</h2>
        {employees.length ? (
          <div className="flex flex-wrap gap-2">
            {employees.map(employee => (
              <Link key={employee.id} href={`/agents/${encodeURIComponent(employee.id)}?tab=knowledge`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-muted/70 px-2.5 py-1.5 text-sm hover:bg-accent">
                <EmployeeAvatar agent={employee} name={employee.name} className="size-7 rounded-lg" /> {employee.name}
              </Link>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">Employee context is available after you build your team.</p>}
      </section>
      <Dialog open={!!dialog} onOpenChange={open => { if (!open && !working) setDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === "file" ? "Upload a shared document" : "Add a reference link"}</DialogTitle>
            <DialogDescription>{dialog === "file"
              ? "Save a Markdown or JSON file directly in this workspace. Employees can read it when their native access permits."
              : "Save a link as a workspace document. The content at the link remains with its source."}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={addKnowledge}>
            {dialog === "file" ? (
              <div className="space-y-2"><Label htmlFor="knowledge-file">Markdown or JSON document</Label>
                <Input name="document" type="file" id="knowledge-file" accept=".md,.json" required disabled={working} /></div>
            ) : (
              <>
                <div className="space-y-2"><Label htmlFor="knowledge-title">Reference name</Label><Input name="title" id="knowledge-title" required maxLength={100} disabled={working} /></div>
                <div className="space-y-2"><Label htmlFor="knowledge-url">Website address</Label><Input name="url" id="knowledge-url" type="url" required maxLength={4096} disabled={working} /></div>
              </>
            )}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={working}>{working ? "Saving…" : "Save to workspace"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

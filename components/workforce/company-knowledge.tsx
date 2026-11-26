"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Brain, FileText, Globe2, Link2, Plus, ScrollText, Search, Table2, UsersRound } from "lucide-react";

import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { SourceAssignments } from "@/components/workforce/source-assignments";
import { MissionControlDialogShell } from "@/components/mission-control/mission-control-dialog-shell";
import { KnowledgeImportDialog } from "@/components/workforce/knowledge-import-dialog";
import { PageHeader } from "@/components/operations/operations-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileView } from "@/components/operations/operations-data";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { deferredSetupDocumentsKey, documentLabel, isAssignableDocument, knowledgeFormatFromPath } from "@/lib/agentos/domains/knowledge-import-formats";
import { redactSecretText } from "@/lib/security/redaction";
import { cn } from "@/lib/utils";

const groups = [
  { id: "documents", label: "Documents", icon: FileText, description: "Source material people and employees can use in this workspace." },
  { id: "profile", label: "Company profile", icon: BookOpen, description: "What this company does and what it aims to accomplish." },
  { id: "guidelines", label: "Guidelines", icon: ScrollText, description: "Working practices, decisions and recurring processes." },
  { id: "sources", label: "References", icon: Link2, description: "Saved links and references. Website contents stay at the source." },
  { id: "employees", label: "Employees", icon: UsersRound, description: "Review the sources assigned to each employee and their native memory." },
  { id: "memory", label: "Memory", icon: Brain, description: "Native memory files retained in the workspace." }
] as const;
type Group = typeof groups[number]["id"];

const managedLabels: Record<string, string> = {
  "docs/brief.md": "Company brief",
  "docs/architecture.md": "How the workspace is organized",
  "docs/guidelines.md": "Working guidelines",
  "MEMORY.md": "Shared memory",
  "memory/decisions.md": "Decision history",
  "memory/blueprint.md": "Workspace plan"
};

export function knowledgeTitle(file: FileView) {
  return managedLabels[file.relativePath] ?? documentLabel(file.relativePath);
}

function groupFor(file: FileView): Group | null {
  const { relativePath, category } = file;
  if (!file.source?.exists || relativePath.startsWith("agents/")) return null;
  if (relativePath === "docs/brief.md") return "profile";
  if (/^docs\/(?:working-)?guidelines(?:-[a-f0-9]{8})?\.md$/.test(relativePath)) return "guidelines";
  if (knowledgeFormatFromPath(relativePath) === "reference") return "sources";
  if (relativePath.startsWith("docs/")) return "documents";
  if (category === "memory") return "memory";
  return null;
}

export function CompanyKnowledge({ files, employees, workspaceId, loading, surfaceTheme, onOpen, onChanged, onManageFiles, children }: {
  files: FileView[];
  employees: MissionControlSnapshot["agents"];
  workspaceId: string | null;
  loading: boolean;
  surfaceTheme: "dark" | "light";
  onOpen: (file: FileView) => void;
  onChanged: () => void;
  onManageFiles: () => void;
  children?: React.ReactNode;
}) {
  const [group, setGroup] = useState<Group>("documents");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingSetup, setPendingSetup] = useState<string[]>([]);
  useEffect(() => {
    let names: string[] = [];
    try {
      const stored = workspaceId ? JSON.parse(sessionStorage.getItem(deferredSetupDocumentsKey(workspaceId)) ?? "null") : null;
      if (Array.isArray(stored)) names = stored.filter((name): name is string => typeof name === "string").slice(0, 12);
    } catch { /* Recovery metadata is optional. */ }
    const frame = window.requestAnimationFrame(() => setPendingSetup(names));
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceId]);
  const [assignment, setAssignment] = useState<FileView | null>(null);
  const selected = groups.find(item => item.id === group)!;
  const query = search.trim().toLowerCase();
  const visible = files.filter(file => groupFor(file) === group && (
    !query || [documentLabel(file.relativePath), managedLabels[file.relativePath], file.workspaceName, knowledgeFormatFromPath(file.relativePath)].join(" ").toLowerCase().includes(query)
  ));
  const SelectedIcon = selected.icon;

  return (
    <>
      <PageHeader title="Knowledge" subtitle="What your company knows and works from."
        primaryAction={{ label: "Add knowledge", icon: Plus, disabled: !workspaceId,
          title: workspaceId ? undefined : "Choose one workspace to add a source.", onClick: () => setImportOpen(true) }} />
      {children}
      {pendingSetup.length > 0 && workspaceId && <div className="workforce-panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div><p className="font-semibold">Finish adding setup documents</p><p className="text-muted-foreground">Select {pendingSetup.join(", ")} again to confirm they are saved.</p></div>
        <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>Reattach documents</Button>
      </div>}
      {message ? <p role="status" className="rounded-lg bg-primary/5 px-3 py-2 text-sm">{message}</p> : null}
      <div className="workforce-library grid min-w-0 gap-4 md:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)]">
        <nav aria-label="Knowledge collections" className="workforce-collections grid min-w-0 grid-cols-3 gap-1 md:flex md:flex-col">
          {groups.map(item => (
            <button key={item.id} type="button" aria-label={item.label} aria-pressed={group === item.id} onClick={() => { setGroup(item.id); setSearch(""); }}
              className={cn("workforce-collection flex min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-sm font-medium md:gap-2.5 md:px-3",
                group === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
              <item.icon aria-hidden="true" className={cn("size-4 shrink-0", group === item.id && "text-primary")} />
              <span className="md:hidden">{item.id === "profile" ? "Company" : item.label}</span><span className="hidden md:inline">{item.label}</span>
            </button>
          ))}
        </nav>
        <section aria-labelledby="workforce-knowledge-heading" aria-busy={loading} className="workforce-panel min-w-0 overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/75 p-4 sm:p-5">
            <div>
              <h2 id="workforce-knowledge-heading" className="workforce-section-title">{selected.label}</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{selected.description}</p>
            </div>
            {group !== "employees" && <label className="relative w-full max-w-[15rem]">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} aria-label={"Search " + selected.label.toLowerCase()} placeholder={"Search " + selected.label.toLowerCase()} className="pl-9" />
            </label>}
          </header>
          {group === "employees" ? (
            <ul className="divide-y divide-border px-3 py-1">
              {employees.map(employee => <li key={employee.id}>
                <Link href={"/agents/" + encodeURIComponent(employee.id) + "?tab=knowledge"} className="workforce-row flex w-full items-center gap-3 px-2 py-2">
                  <EmployeeAvatar agent={employee} name={employee.name} className="size-9 rounded-lg" />
                  <span className="flex-1 text-sm font-semibold">{employee.name}</span><ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                </Link>
              </li>)}
              {!employees.length && <li className="p-3 text-sm text-muted-foreground">Employee context appears here after you build your team.</li>}
            </ul>
          ) : visible.length ? (
            <ul className="divide-y divide-border/80 px-3 py-1">
              {visible.map(file => {
                const format = knowledgeFormatFromPath(file.relativePath);
                const title = knowledgeTitle(file);
                const FileIcon = format === "web" ? Globe2 : format === "xlsx" || format === "csv" ? Table2 : SelectedIcon;
                return <li key={file.id} className="workforce-row flex items-center gap-1">
                  <button type="button" onClick={() => onOpen(file)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left">
                    <span className="workforce-source-icon grid size-11 shrink-0 place-items-center rounded-xl"><FileIcon aria-hidden="true" className="size-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold capitalize">{title}</span>
                      <span className="text-xs text-muted-foreground">{format === "reference" ? "Saved reference" : format === "web" ? "Imported webpage" : format === "note" ? "Note" : format?.toUpperCase() || "Workspace file"} · {file.workspaceName}{file.sizeBytes != null ? " · " + new Intl.NumberFormat("en", { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 }).format(file.sizeBytes / 1024) : ""}</span>
                    </span>
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                  {isAssignableDocument(file.relativePath) && employees.some(employee => employee.workspaceId === file.workspaceId) &&
                    <Button size="sm" variant="ghost" onClick={() => setAssignment(file)} aria-label={"Assign " + title + (format ? ` (${format.toUpperCase()})` : "")}>Assign</Button>}
                </li>;
              })}
            </ul>
          ) : (
            <div className="flex items-start gap-3 p-5 sm:p-6">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <SelectedIcon aria-hidden="true" className="size-4" />
              </span>
              <div>
                <p role={loading ? "status" : undefined} className="text-sm font-semibold">{loading ? "Loading workspace sources…" : query ? "No matching sources" : "No " + selected.label.toLowerCase() + " yet"}</p>
                {!loading && !query && group === "documents" && <p className="mt-1 text-sm text-muted-foreground">Add materials your team can refer to, such as a product brief or an editorial guide.</p>}
              </div>
            </div>
          )}
        </section>
      </div>
      <details className="border-t border-border/75 py-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced file access</summary>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" disabled={!workspaceId} onClick={onManageFiles}>Manage workspace context</Button>
          <Link href="/files" className="text-sm font-medium text-primary hover:underline">Browse managed files</Link>
        </div>
      </details>
      {workspaceId && importOpen ? <KnowledgeImportDialog workspaceId={workspaceId} surfaceTheme={surfaceTheme}
        onClose={() => setImportOpen(false)} onImported={results => {
          const { title, kind, disposition } = results[0];
          if (pendingSetup.length) {
            const imported = new Set(results.flatMap(result => result.originalFilename ? [redactSecretText(result.originalFilename).slice(0, 200)] : []));
            const remaining = pendingSetup.filter(name => !imported.has(name));
            setPendingSetup(remaining);
            try {
              const key = deferredSetupDocumentsKey(workspaceId);
              if (remaining.length) sessionStorage.setItem(key, JSON.stringify(remaining));
              else sessionStorage.removeItem(key);
            } catch { /* Managed files are already saved. */ }
          }
          setImportOpen(false); setSearch(""); setGroup(kind === "reference" ? "sources" : "documents");
          setMessage(results.length > 1 ? results.length + " sources added." : title + (disposition === "already-saved" ? " is already in the workspace." : kind === "reference" ? " saved as a reference." : " added to the workspace.")); onChanged();
        }} /> : null}
      {assignment?.workspaceId ? <MissionControlDialogShell open variant="quiet" surfaceTheme={surfaceTheme}
        title={knowledgeTitle(assignment)} description="Employee memory search"
        contentClassName="workforce-setup-card sm:w-[min(92vw,640px)]"
        onOpenChange={open => { if (!open) setAssignment(null); }}>
        <SourceAssignments workspaceId={assignment.workspaceId} path={assignment.relativePath} employees={employees} />
      </MissionControlDialogShell> : null}
    </>
  );
}

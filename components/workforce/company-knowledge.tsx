"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Brain, FileText, Link2, Plus, ScrollText, Search, UsersRound } from "lucide-react";

import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { EmployeeDocuments, documentLabel } from "@/components/workforce/employee-documents";
import { KnowledgeImportDialog } from "@/components/workforce/knowledge-import-dialog";
import { PageHeader } from "@/components/operations/operations-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FileView } from "@/components/operations/operations-data";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { isAssignableDocument, knowledgeFormatFromPath } from "@/lib/agentos/domains/knowledge-import-formats";
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
  const [assignment, setAssignment] = useState<FileView | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const selected = groups.find(item => item.id === group)!;
  const query = search.trim().toLowerCase();
  const visible = files.filter(file => groupFor(file) === group && (
    !query || [documentLabel(file.relativePath), managedLabels[file.relativePath], file.workspaceName, knowledgeFormatFromPath(file.relativePath)].join(" ").toLowerCase().includes(query)
  ));
  const SelectedIcon = selected.icon;

  return (
    <>
      <PageHeader title="Knowledge" subtitle="The facts, documents and guidelines your company works from."
        primaryAction={{ label: "Add knowledge", icon: Plus, disabled: !workspaceId,
          title: workspaceId ? undefined : "Choose one workspace to add a source.", onClick: () => setImportOpen(true) }} />
      {children}
      {message ? <p role="status" className="rounded-lg bg-primary/5 px-3 py-2 text-sm">{message}</p> : null}
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)]">
        <nav aria-label="Knowledge collections" className="workforce-collections grid min-w-0 grid-cols-2 gap-1 sm:grid-cols-3 md:flex md:flex-col">
          {groups.map(item => (
            <button key={item.id} type="button" aria-pressed={group === item.id} onClick={() => { setGroup(item.id); setSearch(""); }}
              className={cn("workforce-collection flex min-w-0 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium",
                group === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
              <item.icon aria-hidden="true" className={cn("size-4", group === item.id && "text-primary")} />
              {item.label}
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
                return <li key={file.id} className="workforce-row flex items-center gap-1">
                  <button type="button" onClick={() => onOpen(file)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><SelectedIcon aria-hidden="true" className="size-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold capitalize">{title}</span>
                      <span className="text-xs text-muted-foreground">{format === "reference" ? "Saved reference" : format === "note" ? "Note" : format?.toUpperCase() || "Workspace file"} · {file.workspaceName}{file.sizeBytes != null ? " · " + new Intl.NumberFormat("en", { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 }).format(file.sizeBytes / 1024) : ""}</span>
                    </span>
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                  {isAssignableDocument(file.relativePath) && employees.some(employee => employee.workspaceId === file.workspaceId) &&
                    <Button size="sm" variant="ghost" onClick={() => { setAssignment(file); setEmployeeId(""); }} aria-label={"Assign " + title}>Assign</Button>}
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
        onClose={() => setImportOpen(false)} onImported={({ title, kind }) => {
          setImportOpen(false); setSearch(""); setGroup(kind === "reference" ? "sources" : "documents");
          setMessage(title + (kind === "reference" ? " saved as a reference." : " added to the workspace.")); onChanged();
        }} /> : null}
      {assignment ? <Dialog open onOpenChange={open => { if (!open) setAssignment(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Assign document</DialogTitle>
            <DialogDescription>Add this shared source to an employee’s memory search. Workspace file access is managed separately.</DialogDescription></DialogHeader>
          <label className="space-y-1.5 text-sm font-medium"><span>Employee</span>
            <select className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
              value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
              <option value="">Choose an employee</option>
              {employees.filter(employee => employee.workspaceId === assignment.workspaceId).map(employee =>
                <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </label>
          {employeeId && assignment.workspaceId ? <EmployeeDocuments key={employeeId} workspaceId={assignment.workspaceId} employeeId={employeeId} path={assignment.relativePath} /> : null}
        </DialogContent>
      </Dialog> : null}
    </>
  );
}

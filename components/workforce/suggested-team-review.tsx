"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectionList } from "@/components/workforce/selection-list";
import { DraftAbilities, abilityName } from "@/components/workforce/draft-abilities";
import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import type { WorkspaceBlueprint, WorkspaceEmployeeDraftEdit } from "@/lib/agentos/domains/workspace-blueprint";

export function SuggestedTeamReview({ blueprint, busy, customizeWorkspace, onSave, onChangePending, children }: {
  blueprint: WorkspaceBlueprint;
  busy: boolean;
  customizeWorkspace: boolean;
  onSave: (employees: WorkspaceEmployeeDraftEdit[]) => Promise<boolean>;
  onChangePending: (pending: boolean) => void;
  children: ReactNode;
}) {
  const proposed = [blueprint.workforce.primaryAgent, ...blueprint.workforce.specialists];
  const [employees, setEmployees] = useState<WorkspaceEmployeeDraftEdit[]>(proposed.map(employee => ({
    id: employee.id, name: employee.name, role: employee.role, purpose: employee.purpose,
    responsibilities: employee.responsibilities, skillIds: employee.skillIds, toolIds: employee.toolIds, knowledgeSourceIds: employee.knowledgeSourceIds ?? []
  })));
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const advancedReview = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (customizeWorkspace && advancedReview.current) {
      advancedReview.current.open = true;
      advancedReview.current.scrollIntoView({ block: "start" });
    }
  }, [customizeWorkspace]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  function edit(id: string, patch: Partial<WorkspaceEmployeeDraftEdit>) {
    setDirty(true);
    onChangePending(true);
    setEmployees(current => current.map(employee => employee.id === id ? { ...employee, ...patch } : employee));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const applied = await onSave(employees.map(employee => ({
      ...employee,
      responsibilities: (instructions[employee.id] ?? employee.responsibilities.join("\n"))
        .split("\n").map(line => line.trim()).filter(Boolean)
    })));
    if (applied) {
      setDirty(false);
      onChangePending(false);
    }
  }

  return (
    <div className="workforce-setup-step mx-auto max-w-2xl space-y-5 px-5 pt-5 sm:px-8">
      <header>
        <h2 ref={heading} tabIndex={-1} className="workforce-heading font-display font-semibold outline-none">Meet your proposed team</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Give each employee a clear role and review their access before launching {blueprint.identity.name}.</p>
      </header>
      <form onSubmit={save} className="space-y-3">
        {employees.map((employee, index) => (
          <details className="workforce-person workforce-person--review !block" key={employee.id}>
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <EmployeeAvatar name={employee.name} />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold">{employee.name || "New employee"}</span>
                <span className="block text-sm text-muted-foreground">{employee.role}{index === 0 ? " · Lead" : ""}</span>
                <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{employee.purpose}</span>
              </span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </summary>
            <fieldset disabled={busy} className="mt-4 space-y-4 border-t border-border/70 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium"><span>Name</span>
                  <Input required maxLength={100} value={employee.name} onChange={e => edit(employee.id, { name: e.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm font-medium"><span>Role</span>
                  <Input required maxLength={100} value={employee.role} onChange={e => edit(employee.id, { role: e.target.value })} />
                </label>
              </div>
              <label className="block space-y-1.5 text-sm font-medium"><span>Responsibility</span>
                <Textarea required maxLength={500} rows={2} value={employee.purpose} onChange={e => edit(employee.id, { purpose: e.target.value })} />
              </label>
              <label className="block space-y-1.5 text-sm font-medium"><span>Working instructions and knowledge to consult</span>
                <Textarea maxLength={3600} rows={3} value={instructions[employee.id] ?? employee.responsibilities.join("\n")} onChange={e => {
                  setDirty(true);
                  onChangePending(true);
                  setInstructions(current => ({ ...current, [employee.id]: e.target.value }));
                }} />
                <span className="block text-xs font-normal text-muted-foreground">One instruction per line. Name the shared references this employee should use.</span>
              </label>
              {blueprint.knowledge.sources.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Shared sources to consult</legend>
                  <p className="text-xs text-muted-foreground">Selections become working guidance. All workspace members retain their existing access.</p>
                  <SelectionList label="Proposed employee sources" selected={employee.knowledgeSourceIds ?? []}
                    onChange={knowledgeSourceIds => edit(employee.id, { knowledgeSourceIds })}
                    empty="No shared sources were attached."
                    items={blueprint.knowledge.sources.map(source => ({ id: source.id, label: source.label,
                      detail: source.status === "ready" ? "Source prepared" : "Reference or pending setup" }))} />
                </fieldset>
              ) : null}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Proposed capabilities</legend>
                {(["skillIds", "toolIds"] as const).flatMap(key => proposed[index][key].map(id => (
                  <label key={key + id} className="flex min-h-10 items-center gap-2 text-sm">
                    <input type="checkbox" checked={employee[key].includes(id)} onChange={e =>
                      edit(employee.id, { [key]: e.target.checked ? [...employee[key], id] : employee[key].filter(item => item !== id) })} />
                    <span className="capitalize">{abilityName(id)} <span className="text-muted-foreground">· {key === "skillIds" ? "Skill" : "Tool"}</span></span>
                  </label>
                )))}
                <DraftAbilities selected={employee.toolIds} proposed={proposed[index].toolIds} onChange={toolIds => edit(employee.id, { toolIds })} />
                {!proposed[index].skillIds.length && !proposed[index].toolIds.length ? <p className="text-sm text-muted-foreground">No additional capabilities are proposed.</p> : null}
              </fieldset>
            </fieldset>
          </details>
        ))}
        <Button variant="secondary" type="submit" disabled={busy || !dirty}>
          <Check aria-hidden="true" className="mr-2 size-4" /> {busy ? "Saving and checking plan…" : "Save team changes"}
        </Button>
        {dirty ? <p role="status" className="text-sm text-muted-foreground">Save your edits to refresh the launch plan.</p> : null}
      </form>
      <p className="text-xs leading-5 text-muted-foreground">You can add more employees from Team after launch.</p>
      <details ref={advancedReview} className="workforce-panel px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <ArrowRight aria-hidden="true" className="size-4" /> Review workspace plan and advanced setup
        </summary>
        {children}
      </details>
    </div>
  );
}

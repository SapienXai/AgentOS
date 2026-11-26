"use client";

import { useCallback, useEffect, useState } from "react";

import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { Button } from "@/components/ui/button";
import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { SelectionList } from "@/components/workforce/selection-list";

type Binding = { id: string; selected: boolean };

export function SourceAssignments({ workspaceId, path, employees }: {
  workspaceId: string;
  path: string;
  employees: MissionControlSnapshot["agents"];
}) {
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const endpoint = "/api/workspaces/" + encodeURIComponent(workspaceId) + "/knowledge/assignments";

  const read = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint + "?source=" + encodeURIComponent(path), { signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not check employee access.");
    const rows = data.employees as Binding[];
    setBindings(rows);
    setSelected(rows.filter(row => row.selected).map(row => row.id));
  }, [endpoint, path]);

  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [read]);

  const byId = new Map(employees.map(employee => [employee.id, employee]));
  const changes = bindings?.filter(row => byId.has(row.id) && row.selected !== selected.includes(row.id)) ?? [];

  async function save() {
    setWorking(true);
    setMessage("");
    setError("");
    let confirmed = 0;
    let pending = 0;
    const failed: string[] = [];
    // Each employee owns a distinct search binding. Read the next config revision
    // after each mutation to avoid racing approved writes to the same Gateway.
    for (const row of changes.slice(0, 12)) {
      try {
        const response = await fetch(endpoint, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: row.id, path, selected: selected.includes(row.id) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (result.status === "configured") confirmed++;
        else pending++;
      } catch {
        failed.push(byId.get(row.id)?.name ?? row.id);
      }
    }
    try { await read(); }
    catch { setError("The latest selections could not be read. Refresh before retrying."); }
    finally { setWorking(false); }
    if (failed.length) setError("Could not update " + failed.join(", ") + ". Review their selections and retry.");
    setMessage(confirmed + " confirmed" + (pending ? " · " + pending + " pending OpenClaw confirmation" : "") + ".");
  }

  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Include this source in employee memory search. Shared file access follows the workspace policy.</p>
    {bindings ? <SelectionList label="Employees" selected={selected} onChange={setSelected} disabled={working}
      empty="No employees with a confirmed local workspace are available."
      items={bindings.flatMap(binding => {
        const employee = byId.get(binding.id);
        return employee ? [{ id: employee.id, label: employee.name,
          icon: <EmployeeAvatar agent={employee} name={employee.name} className="size-8 rounded-lg" />,
          detail: binding.selected ? "Native search binding confirmed" : "Shared workspace access" }] : [];
      })} /> : !error ? <p role="status" className="text-sm text-muted-foreground">Checking native assignments…</p> : null}
    {changes.length > 12 && <p role="alert" className="text-sm">Save up to 12 employee changes at a time.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm font-medium">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" type="button" disabled={working || !changes.length || changes.length > 12} onClick={() => void save()}>
        {working ? "Saving assignments…" : "Save assignments"}
      </Button>
      {(error || message) && <Button size="sm" type="button" variant="ghost" disabled={working}
        onClick={() => { setError(""); void read().catch(failure => setError(failure.message)); }}>Refresh</Button>}
    </div>
  </div>;
}

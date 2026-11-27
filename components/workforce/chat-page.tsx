"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FileText, MessageCircle, Search } from "lucide-react";
import dynamic from "next/dynamic";

import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { OperationsShell, type OperationsShellContext } from "@/components/operations/operations-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AddModelsProviderId } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

const AddModelsDialog = dynamic(() => import("@/components/mission-control/add-models/add-models-dialog").then(module => module.AddModelsDialog));

export function WorkforceChatRoute({ initialSnapshot }: { initialSnapshot: MissionControlSnapshot }) {
  return (
    <OperationsShell initialSnapshot={initialSnapshot}>
      {(context) => <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Loading conversations…</p>}><ChatPageContent {...context} /></Suspense>}
    </OperationsShell>
  );
}

function ChatPageContent({ snapshot, rootSnapshot, activeWorkspaceId, surfaceTheme, refresh, setSnapshot }: OperationsShellContext) {
  const params = useSearchParams();
  const requested = params.get("employee");
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<AddModelsProviderId | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const roster = snapshot.agents;
  const employee = requested ? roster.find(agent => agent.id === requested) ?? null : null;
  const latestResult = employee ? snapshot.tasks.find((task) =>
    task.primaryAgentId === employee.id && task.workspaceId === employee.workspaceId && task.dispatchId &&
    (task.status === "completed" || task.status === "stalled" || task.status === "cancelled")
  ) : null;
  const filtered = roster.filter(agent => formatAgentDisplayName(agent).toLowerCase().includes(search.trim().toLowerCase()));
  const conversationTitle = employee ? formatAgentDisplayName(employee) : "Chat";

  useEffect(() => {
    if (requested) heading.current?.focus({ preventScroll: true });
  }, [requested]);

  const selectEmployee = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("employee", id);
    else url.searchParams.delete("employee");
    window.history.pushState(null, "", url);
  };

  return (
    <div className="workforce-chat-panel grid min-w-0 overflow-hidden workforce-panel md:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)]">
      <section aria-label="Employees" className={cn("min-h-0 min-w-0 overflow-y-auto md:border-r md:border-border", employee && "hidden md:block")}>
        <div className="px-4 pb-2 pt-4">
          <h1 className="workforce-heading font-display font-semibold">Chat</h1>
          <div className="relative mt-3">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Find an employee" value={search} onChange={event => setSearch(event.target.value)}
              placeholder="Find an employee" className="h-11 pl-9 text-base sm:text-sm" />
          </div>
        </div>
        <ul className="space-y-0.5 px-2 pb-3">
          {filtered.map(agent => {
            const name = formatAgentDisplayName(agent);
            return (
              <li key={agent.id}>
                <button type="button" aria-pressed={employee?.id === agent.id} onClick={() => selectEmployee(agent.id)}
                  className={cn("flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-ring motion-reduce:transition-none",
                    employee?.id === agent.id && "bg-primary/10")}>
                  <EmployeeAvatar agent={agent} name={name} className="size-9 rounded-lg" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{agent.workerProfile?.employment.role || "Employee"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {filtered.length === 0 ? <p className="px-4 pb-5 text-sm leading-6 text-muted-foreground">
          {roster.length ? "No employees match your search." : "Add an employee in Team to start a conversation."}
        </p> : null}
      </section>
      <section aria-label={conversationTitle} className={cn("flex min-h-0 min-w-0 flex-col bg-background", !employee && "hidden md:flex")}>
        {employee ? (
          <>
            <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-5">
              <Button variant="ghost" size="icon" aria-label="Back to employees" className="size-11 md:hidden" onClick={() => selectEmployee(null)}><ArrowLeft className="size-4" /></Button>
              <EmployeeAvatar agent={employee} name={conversationTitle} className="size-9 rounded-lg" />
              <div className="min-w-0">
                <h2 ref={heading} tabIndex={-1} className="truncate text-base font-semibold outline-none">{conversationTitle}</h2>
                <Link href={`/agents/${encodeURIComponent(employee.id)}`} className="text-xs font-medium text-muted-foreground hover:underline">{employee.workerProfile?.employment.role || "Employee"} · Profile</Link>
              </div>
              <div className="ml-auto hidden shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
                <Link href={`/agents/${encodeURIComponent(employee.id)}?tab=knowledge`} className="hover:underline">Knowledge</Link>
                <Link href={`/agents/${encodeURIComponent(employee.id)}?tab=capabilities`} className="hover:underline">Abilities</Link>
              </div>
            </header>
            {latestResult?.dispatchId ? (
              <Link href={`/missions/${encodeURIComponent(latestResult.dispatchId)}#deliverable`}
                className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs font-medium text-primary hover:bg-accent sm:px-5">
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Latest task result · {latestResult.title}</span>
              </Link>
            ) : null}
            <div className="min-h-0 flex-1">
              <AgentChatDrawer agent={employee} key={employee.id} snapshot={rootSnapshot} isVisible surface="transparent" draftWorkspaceId={employee.workspaceId}
                onRefresh={refresh} onSnapshotChange={setSnapshot} onConnectModelProvider={setProvider} />
            </div>
          </>
        ) : (
          <div className="m-auto max-w-sm px-6 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-card text-muted-foreground"><MessageCircle className="size-5" /></span>
            <h2 className="mt-4 text-lg font-semibold">{requested ? "Employee unavailable" : "Open a conversation"}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {requested && activeWorkspaceId ? "Switch to All workspaces or choose an employee in this workspace." : "Choose an employee to see their conversations and send a message."}
            </p>
          </div>
        )}
      </section>
      {provider ? <AddModelsDialog open initialProvider={provider} snapshot={rootSnapshot} surfaceTheme={surfaceTheme}
        onOpenChange={open => { if (!open) setProvider(null); }} onSnapshotChange={setSnapshot} /> : null}
    </div>
  );
}

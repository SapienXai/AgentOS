"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";

import { OnboardingProgress } from "@/components/workforce/onboarding-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type FirstEmployeeDraft = { id: string; name: string; role: string };
export const firstEmployeeDraft: FirstEmployeeDraft = { id: "assistant", name: "Assistant", role: "General assistant" };

export function FirstWorkspaceForms({
  manual, name, brief, team, onName, onBrief, onTeam, onGenerate, onManual, onBack, onLaunch,
  working, error, information, children
}: {
  manual: boolean;
  name: string;
  brief: string;
  team: FirstEmployeeDraft[];
  onName: (name: string) => void;
  onBrief: (brief: string) => void;
  onTeam: (team: FirstEmployeeDraft[]) => void;
  onGenerate: () => void;
  onManual: () => void;
  onBack: () => void;
  onLaunch: () => void;
  working: boolean;
  error?: string | null;
  information?: string | null;
  children?: React.ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [manual]);

  return (
    <div className="mx-auto max-w-xl px-5 pb-8 pt-5 sm:px-8 sm:pt-7">
      <OnboardingProgress current={manual ? 3 : 2} />
      <h2 ref={heading} tabIndex={-1} className="workforce-heading mt-6 font-display font-semibold outline-none">
        {manual ? "Choose your first employees" : "Make room for your work"}
      </h2>
      <p className="mb-6 mt-2 text-sm leading-6 text-muted-foreground">
        {manual ? "Start with one assistant or add teammates with a clear role." : "Give your team a place to work and a purpose to start from."}
      </p>
      <form ref={form} aria-label={manual ? "Build your team" : "Create your workspace"} className="space-y-5"
        onSubmit={(event) => { event.preventDefault(); if (!working) (manual ? onLaunch : onGenerate)(); }}>
        {manual ? (
          <div className="space-y-3">
            {team.map((person, index) => (
              <fieldset key={person.id} disabled={working} className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]">
                <legend className="px-1 text-xs font-medium text-muted-foreground">{index === 0 ? "Lead employee" : "Employee " + (index + 1)}</legend>
                <div className="space-y-1.5">
                  <Label htmlFor={person.id + "-name"}>Name</Label>
                  <Input id={person.id + "-name"} name={person.id + "-name"} required maxLength={64} value={person.name}
                    className="min-h-12 text-base sm:text-sm" onChange={(event) => onTeam(team.map((entry) => entry.id === person.id ? { ...entry, name: event.target.value } : entry))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={person.id + "-role"}>Role</Label>
                  <Input id={person.id + "-role"} name={person.id + "-role"} required maxLength={100} value={person.role}
                    className="min-h-12 text-base sm:text-sm" onChange={(event) => onTeam(team.map((entry) => entry.id === person.id ? { ...entry, role: event.target.value } : entry))} />
                </div>
                {team.length > 1 ? <Button type="button" size="icon" variant="ghost" aria-label={`Remove employee ${index + 1}`}
                  className="size-12 sm:self-end" onClick={() => onTeam(team.filter((entry) => entry.id !== person.id))}><X className="size-4" /></Button> : null}
              </fieldset>
            ))}
            {team.length < 8 ? <Button type="button" variant="secondary" disabled={working} className="min-h-12"
              onClick={() => onTeam([...team, { id: crypto.randomUUID(), name: "", role: "" }])}>
              <Plus className="mr-2 size-4" /> Add employee
            </Button> : null}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="first-workspace-name">Workspace name</Label>
              <Input id="first-workspace-name" name="workspaceName" required maxLength={80} autoComplete="organization"
                className="min-h-12 text-base sm:text-sm" value={name} onChange={(event) => onName(event.target.value)} placeholder="e.g. Fieldwork Studio" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="first-workspace-brief">What are you working on?</Label>
              <Textarea id="first-workspace-brief" name="workspaceBrief" required maxLength={3000} rows={4}
                className="min-h-28 text-base sm:text-sm" value={brief} onChange={(event) => onBrief(event.target.value)}
                placeholder="Describe your company or project and the work you want help with." />
            </div>
            {children}
          </>
        )}
        {error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        {information ? <p role="status" className="text-sm text-muted-foreground">{information}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" disabled={working} className="min-h-12" onClick={() => {
            if (manual) onBack();
            else if (form.current?.reportValidity()) onManual();
          }}>{manual ? <><ArrowLeft className="mr-2 size-4" /> Back</> : "Build team manually"}</Button>
          <Button type="submit" disabled={working} className="min-h-12">
            {manual ? working ? "Launching workspace…" : "Launch workspace" : "Suggest a team"}
            <ArrowRight aria-hidden="true" className="ml-2 size-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}

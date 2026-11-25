"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Template = {
  packageName: string;
  displayName: string;
  summary?: string;
  latestVersion?: string;
  official: boolean;
};

type TemplateDetail = Template & {
  version: string;
  workspaceFiles: number;
  skills: number;
  plugins: number;
  mcpServers: number;
  scheduledJobs: number;
  contents?: { instructions: Array<{ name: string; source: string }> };
  security?: { verdict?: string };
};

type Search = { q?: string; packageName?: string; version?: string };

export function ClawHubTemplateCatalog() {
  const [search, setSearch] = useState<Search>();
  const [entries, setEntries] = useState<Template[]>();
  const [detail, setDetail] = useState<TemplateDetail>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!search) return;
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (search.q) query.set("q", search.q);
    if (search.packageName) query.set("packageName", search.packageName);
    if (search.version) query.set("version", search.version);
    void (async () => {
      try {
        const response = await fetch(`/api/workspaces/templates?${query}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { entries?: Template[]; detail?: TemplateDetail; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "OpenClaw could not read templates.");
        if (result.entries) setEntries(result.entries);
        setDetail(result.detail);
        setStatus(result.entries?.length === 0 ? "No matching templates." : "");
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "OpenClaw could not read templates.");
      }
    })();
    return () => controller.abort();
  }, [search]);

  const find = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDetail(undefined);
    setEntries(undefined);
    setStatus("Reading OpenClaw’s ClawHub catalog…");
    setSearch({ q: String(new FormData(event.currentTarget).get("query")).trim() });
  };

  return (
    <details className="mt-4 rounded-xl border border-border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Browse ClawHub agent templates</summary>
      <div className="mt-3 space-y-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={find}>
          <label className="min-w-40 flex-1 space-y-1">Template search
            <Input name="query" type="search" maxLength={200} />
          </label>
          <Button type="submit" size="sm" variant="secondary">Search</Button>
        </form>
        <p role="status" className={status ? "text-xs text-muted-foreground" : "sr-only"}>{status}</p>
        {entries?.length ? (
          <ul className="max-h-48 space-y-2 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.packageName} className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium">{entry.displayName}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {entry.packageName}{entry.official ? " · Official" : " · Community"}
                  </p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => {
                  setDetail(undefined);
                  setStatus("Reading the template release…");
                  setSearch({ packageName: entry.packageName, version: entry.latestVersion });
                }}>Review</Button>
              </li>
            ))}
          </ul>
        ) : null}
        {detail ? (
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="font-medium">{detail.displayName} {detail.version}</p>
            {detail.summary ? <p className="text-xs text-muted-foreground">{detail.summary}</p> : null}
            <p className="text-xs text-muted-foreground">
              {detail.workspaceFiles} workspace files · {detail.skills} skills · {detail.plugins} plugins · {detail.mcpServers} MCP servers · {detail.scheduledJobs} scheduled jobs
            </p>
            {detail.security?.verdict ? <p className="text-xs text-muted-foreground">ClawHub audit {detail.security.verdict}</p> : null}
            {detail.contents?.instructions.length ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {detail.contents.instructions.map(({ name, source }) => <li key={`${source}:${name}`}>{name}</li>)}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">OpenClaw handles template installation from its Control UI.</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

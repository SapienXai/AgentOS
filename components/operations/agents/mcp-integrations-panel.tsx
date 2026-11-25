"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Server = {
  name: string;
  host: string | null;
  transport: "streamable-http" | "sse" | "stdio" | "unknown";
  enabled: boolean;
  auth: "none" | "shared" | "per-requester";
  editable: boolean;
};

export function McpIntegrationsPanel({ effectiveTools }: {
  effectiveTools?: Array<{ id: string; available: boolean }> | null;
}) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [inventory, setInventory] = useState<{ servers: Server[]; controlUiUrl?: string | null } | null>(null);
  const servers = inventory?.servers;
  const [readError, setReadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ server?: Server }>();
  const [confirmation, setConfirmation] = useState<{ action: "remove" | "logout"; name: string }>();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/integrations/mcp", { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { servers?: Server[]; controlUiUrl?: string | null; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !result.servers) {
          setInventory(null);
          setReadError(response.status === 401 || response.status === 403
            ? "MCP configuration is available to authorized operators."
            : (result.error || "OpenClaw could not read the MCP inventory."));
          return;
        }
        setReadError("");
        setInventory({ servers: result.servers, controlUiUrl: result.controlUiUrl });
      } catch {
        if (!controller.signal.aborted) {
          setInventory(null);
          setReadError("OpenClaw could not read the MCP inventory.");
        }
      }
    })();
    return () => controller.abort();
  }, [open, revision]);

  const refresh = () => {
    setReadError("");
    setInventory(null);
    setRevision((current) => current + 1);
  };

  const mutate = async (input: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "OpenClaw rejected the change.");
      setMessage(success);
      setForm(undefined);
      setConfirmation(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh the inventory to check the result.");
    } finally {
      refresh();
      setBusy(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const endpoint = String(fields.get("endpoint") ?? "").trim();
    void mutate({
      ...(form?.server ? { action: "edit", name: form.server.name } :
        { action: "create", name: String(fields.get("name")).trim(), oauth: fields.has("oauth") }),
      ...(endpoint ? { endpoint } : {}),
      enabled: fields.has("enabled"),
      transport: fields.get("transport")
    }, "OpenClaw saved the server configuration.");
  };

  return (
    <details className="border-t border-border/70 pt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs font-semibold">MCP integrations</summary>
      {open ? (
        <div className="mt-2 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground">Manage servers configured on this OpenClaw Gateway.</p>
            <div className="flex flex-wrap gap-2">
              {servers ? <Button type="button" size="sm" variant="secondary" disabled={busy}
                onClick={() => { setConfirmation(undefined); setForm({}); }}>Add server</Button> : null}
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={refresh}>Refresh</Button>
            </div>
          </div>
          <p role="status" className={message ? "text-muted-foreground" : "sr-only"}>{message}</p>
          {readError ? <p role="status" className="text-muted-foreground">{readError}</p> : null}
          {!servers && !readError ? <p role="status" className="text-muted-foreground">Loading MCP inventory…</p> : null}
          {servers?.length === 0 ? <p className="text-muted-foreground">No servers are configured.</p> : null}
          {servers?.length ? (
            <ul className="space-y-2">
              {servers.map((server) => (
                <li key={server.name} className="rounded-xl border border-border bg-background/65 px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="break-words font-medium">{server.name}</p>
                      <p className="break-all text-muted-foreground">
                        {server.host ? `${server.host} · ` : ""}{server.transport} · {server.enabled ? "Enabled" : "Disabled"}
                      </p>
                      {server.auth === "shared" ? <p className="text-muted-foreground">
                        {inventory?.controlUiUrl ? <a className="underline underline-offset-2" href={inventory.controlUiUrl}
                          target="_blank" rel="noopener noreferrer">Open OpenClaw MCP settings (opens in a new tab)</a>
                          : "Open MCP settings in the OpenClaw Control UI to sign in to this server."}
                      </p> : null}
                      {server.auth === "per-requester" ? <p className="text-muted-foreground">
                        OpenClaw authorizes each requester in their native session.
                      </p> : null}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {server.editable ? <>
                        <Button type="button" size="sm" variant="ghost" disabled={busy}
                          onClick={() => { setConfirmation(undefined); setForm({ server }); }}>Edit</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={busy}
                          onClick={() => { setForm(undefined); setConfirmation({ action: "remove", name: server.name }); }}>Remove</Button>
                      </> : null}
                      {server.auth === "shared" ? <Button type="button" size="sm" variant="ghost" disabled={busy}
                        onClick={() => { setForm(undefined); setConfirmation({ action: "logout", name: server.name }); }}>Sign out</Button> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {confirmation ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2.5">
              <p className="flex-1">{confirmation.action === "remove"
                ? `Remove ${confirmation.name} from the Gateway configuration?`
                : `Clear the shared OpenClaw sign-in for ${confirmation.name}?`}</p>
              <Button type="button" size="sm" variant="destructive" disabled={busy}
                onClick={() => void mutate(confirmation, confirmation.action === "remove" ? "Server removed." : "Shared credentials cleared.")}>
                {confirmation.action === "remove" ? "Remove server" : "Clear sign-in"}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmation(undefined)}>Cancel</Button>
            </div>
          ) : null}
          {form ? (
            <form key={form.server?.name ?? "new"} onSubmit={save} className="space-y-3 rounded-xl border border-border px-3 py-2.5">
              {form.server ? <p className="font-medium">Edit {form.server.name}</p> : (
                <label className="block space-y-1">Server name
                  <Input name="name" required maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}" />
                </label>
              )}
              <label className="block space-y-1">{form.server ? "Replacement endpoint (optional)" : "Endpoint"}
                <Input name="endpoint" type="url" required={!form.server} maxLength={2048} autoComplete="off" />
              </label>
              <label className="block space-y-1">Transport
                <select name="transport" defaultValue={form.server?.transport ?? "streamable-http"}
                  className="block h-9 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="streamable-http">Streamable HTTP</option>
                  <option value="sse">SSE</option>
                </select>
              </label>
              <label className="flex items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={form.server?.enabled ?? true} /> Enabled</label>
              {!form.server ? <label className="flex items-center gap-2"><input name="oauth" type="checkbox" /> Requires OAuth sign-in</label> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={busy}>Save server</Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setForm(undefined)}>Cancel</Button>
              </div>
            </form>
          ) : null}
          <div className="space-y-1">
            <p className="font-medium">MCP tools for the selected session</p>
            {effectiveTools?.length ? (
              <ul className="space-y-1 text-muted-foreground">
                {effectiveTools.map(({ id, available }) => (
                  <li key={id} className="break-words">{id} · {available ? "Available" : "Denied by session"}</li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">{effectiveTools
              ? "OpenClaw currently reports no effective MCP tools for this session."
              : "OpenClaw has not verified MCP tools for the selected session."}</p>}
          </div>
        </div>
      ) : null}
    </details>
  );
}

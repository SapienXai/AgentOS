"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, ShieldCheck, Trash2, UserRound, UserX } from "lucide-react";

import { useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

type UserSummary = {
  actorId: string;
  username: string;
  role: "owner" | "member";
  status: "active" | "disabled";
  profile: { displayName: string; email: string };
};

export function UserManagementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const { status: protectionStatus } = useInstanceProtection();

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const payload = (await response.json()) as { users?: UserSummary[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Users could not be loaded.");
      const localUsers = payload.users ?? [];
      setUsers(localUsers);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Users could not be loaded.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadUsers();
  }, [loadUsers, open]);

  const createUser = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: "member", displayName: username, email: "" })
      });
      const payload = (await response.json()) as { user?: UserSummary; error?: string };
      if (!response.ok) throw new Error(payload.error || "User could not be created.");
      setUsername("");
      setPassword("");
      await loadUsers();
      toast.success("Member account created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "User could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (user: UserSummary, body: Record<string, unknown>, message: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: user.actorId, ...body })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "User could not be updated.");
      await loadUsers();
      toast.success(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "User could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: deleteTarget.actorId })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "User could not be deleted.");
      const deletedName = deleteTarget.profile.displayName || deleteTarget.username;
      setDeleteTarget(null);
      const refreshed = await loadUsers();
      toast.success("AgentOS account deleted.", {
        description: refreshed
          ? `${deletedName} can no longer sign in. OpenClaw runtime data was not changed.`
          : `${deletedName} was deleted. The account list could not refresh; use Refresh users to confirm.`
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "User could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Team</DialogTitle>
            <DialogDescription>Manage the people who can access this AgentOS instance. OpenClaw runtime identities remain separate.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2"><Plus className="size-4 text-primary" /><p className="text-sm font-semibold">Create member</p></div>
              <div className="grid gap-3">
                <div className="grid gap-1.5"><Label htmlFor="new-agentos-username">Username</Label><Input id="new-agentos-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" /></div>
                <div className="grid gap-1.5"><Label htmlFor="new-agentos-password">Initial password</Label><Input id="new-agentos-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></div>
                <Button type="button" onClick={() => void createUser()} disabled={saving || !username.trim() || !password}><Plus className="mr-2 size-4" />Create member</Button>
              </div>
            </div>

            <div className="min-h-40 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm font-semibold">Accounts</p><Button type="button" variant="ghost" size="icon" onClick={() => void loadUsers()} disabled={loading} aria-label="Refresh users"><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button></div>
              {loading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading accounts…</p> : users.length === 0 ? <p className="text-xs text-muted-foreground">No accounts are available.</p> : <div className="space-y-2">{users.map((user) => {
                const isCurrentUser = protectionStatus?.actorId === user.actorId;
                return <div key={user.actorId} className="rounded-lg border border-border/70 p-2.5">
                  <div className="flex items-start gap-2"><span className="mt-0.5 rounded-md bg-muted p-1.5"><UserRound className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.profile.displayName || user.username}</p><p className="truncate text-[11px] text-muted-foreground">@{user.username}</p></div><div className="flex shrink-0 items-center gap-1.5"><Badge variant="muted" className="capitalize">{user.role}</Badge><Badge variant={user.status === "active" ? "success" : "muted"}>{user.status}</Badge></div></div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void updateUser(user, { operation: "status", status: user.status === "active" ? "disabled" : "active" }, user.status === "active" ? "User disabled." : "User enabled.")}><UserX className="mr-1.5 size-3.5" />{user.status === "active" ? "Disable" : "Enable"}</Button>{user.role === "member" ? <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void updateUser(user, { operation: "role", role: "owner" }, "User promoted to owner.")}><ShieldCheck className="mr-1.5 size-3.5" />Promote</Button> : null}<Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={saving || isCurrentUser} title={isCurrentUser ? "You cannot delete the account you are currently using." : "Delete this AgentOS account"} onClick={() => setDeleteTarget(user)}><Trash2 className="mr-1.5 size-3.5" />Delete</Button></div>
                </div>;
              })}</div>}
            </div>
          </div>

          {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
          <DialogFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(nextOpen) => !saving && !nextOpen && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete AgentOS account?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `${deleteTarget.profile.displayName || deleteTarget.username} will no longer be able to sign in to AgentOS.` : "This account will no longer be able to sign in to AgentOS."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs leading-5 text-destructive">
            This cannot be undone. Only the AgentOS login is removed; OpenClaw identities, workspaces, agents, and runtime data remain unchanged.
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)} disabled={saving}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void deleteUser()} disabled={saving}>{saving ? "Deleting…" : "Delete account"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, ShieldOff } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { broadcastAuthChange, useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

type FieldErrors = Partial<Record<"username" | "password" | "confirmPassword" | "currentPassword", string>>;

export function InstanceProtectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { status, loading, applyStatus, lock } = useInstanceProtection();
  const [enabledSwitch, setEnabledSwitch] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername(status?.username ?? "");
    setPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
    setErrors({});
    setShowPasswords(false);
    setEnabledSwitch(true);
  }, [open, status?.username]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validate(status?.protectionEnabled === true, { username, password, confirmPassword, currentPassword });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || (!status?.protectionEnabled && !enabledSwitch)) return;

    setSubmitting(true);
    try {
      const action = status?.protectionEnabled ? "update" : "enable";
      const response = await fetch("/api/auth/protection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "enable"
          ? { action, username: username.trim(), password }
          : { action, username: username.trim(), currentPassword, newPassword: password || undefined })
      });
      const payload = (await response.json()) as NonNullable<typeof status> & { error?: string; code?: string };
      if (!response.ok || payload.error) {
        if (payload.code === "invalid-current-password") setErrors({ currentPassword: payload.error });
        else throw new Error(payload.error || "Protection settings could not be saved.");
        return;
      }
      applyStatus(payload);
      broadcastAuthChange();
      setPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      toast.success(action === "enable" ? "Instance Protection enabled." : "Credentials updated.", {
        description: action === "enable" ? "This browser remains unlocked for the current session." : "Previous sessions have been invalidated."
      });
    } catch (caught) {
      toast.error("Protection update failed.", { description: caught instanceof Error ? caught.message : "Unknown error." });
    } finally {
      setSubmitting(false);
    }
  };

  const disable = async () => {
    setSubmitting(true);
    setDisableError(null);
    try {
      const response = await fetch("/api/auth/protection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", currentPassword: disablePassword })
      });
      const payload = (await response.json()) as NonNullable<typeof status> & { error?: string };
      if (!response.ok || payload.error) {
        setDisableError(payload.error || "Protection could not be disabled.");
        return;
      }
      applyStatus(payload);
      broadcastAuthChange();
      setDisableOpen(false);
      setDisablePassword("");
      onOpenChange(false);
      toast.success("Instance Protection disabled.", { description: "AgentOS is directly accessible again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
        <DialogContent className="max-h-[min(88vh,760px)] max-w-[540px] overflow-y-auto p-0">
          <div className="border-b border-border/70 px-6 pb-5 pt-6">
            <DialogHeader>
              <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><LockKeyhole className="h-5 w-5" /></div>
              <DialogTitle>Login &amp; Protection</DialogTitle>
              <DialogDescription>Protect access to this AgentOS instance without changing OpenClaw, workspaces, agents, or tasks.</DialogDescription>
            </DialogHeader>
          </div>

          {loading || !status ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading protection settings…</div>
          ) : (
            <form onSubmit={submit} className="space-y-5 px-6 py-5">
              {!status.protectionEnabled ? (
                <>
                  <section className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/35 p-4">
                    <div><p className="text-sm font-semibold">Instance Protection</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Require a username and password before AgentOS can be opened.</p></div>
                    <Switch checked={enabledSwitch} onChange={setEnabledSwitch} label="Enable Instance Protection" />
                  </section>
                  <CredentialFields username={username} setUsername={setUsername} password={password} setPassword={setPassword} confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword} showPasswords={showPasswords} setShowPasswords={setShowPasswords} errors={errors} passwordLabel="Password" passwordAutoComplete="new-password" />
                  <p className="rounded-xl border border-border/70 bg-background px-3.5 py-3 text-xs leading-5 text-muted-foreground">This only protects access to the AgentOS instance running on this machine. It does not create a multi-user account or modify OpenClaw data.</p>
                  <Button type="submit" className="w-full" disabled={submitting || !enabledSwitch}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save &amp; Enable Protection</Button>
                </>
              ) : (
                <>
                  <SectionTitle title="Account" detail="Changing credentials invalidates all previous sessions." />
                  <CredentialFields username={username} setUsername={setUsername} password={password} setPassword={setPassword} confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword} showPasswords={showPasswords} setShowPasswords={setShowPasswords} errors={errors} passwordLabel="New password (optional)" passwordAutoComplete="new-password" />
                  <Field label="Current password" htmlFor="protection-current-password" error={errors.currentPassword}>
                    <Input id="protection-current-password" type={showPasswords ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                  </Field>
                  <Button type="submit" className="w-full" disabled={submitting}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update Credentials</Button>

                  <div className="h-px bg-border" />
                  <SectionTitle title="Protection" detail="Protection is active for this AgentOS instance." />
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4">
                    <ShieldCheck className="h-5 w-5 text-emerald-500" /><div><p className="text-sm font-semibold">Protected</p><p className="text-xs text-muted-foreground">Signed session required</p></div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="secondary" onClick={() => void lock()}><LockKeyhole className="mr-2 h-4 w-4" />Lock AgentOS Now</Button>
                    <Button type="button" variant="destructive" onClick={() => { setDisablePassword(""); setDisableError(null); setDisableOpen(true); }}><ShieldOff className="mr-2 h-4 w-4" />Disable Protection</Button>
                  </div>
                </>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={(next) => !submitting && setDisableOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Disable Instance Protection?</DialogTitle><DialogDescription>This removes the stored credential and invalidates every active session. Workspace, agent, task, integration, and OpenClaw data remain unchanged.</DialogDescription></DialogHeader>
          <Field label="Current password" htmlFor="disable-protection-password" error={disableError ?? undefined}>
            <Input id="disable-protection-password" type="password" autoComplete="current-password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && disablePassword) void disable(); }} />
          </Field>
          <DialogFooter><Button type="button" variant="secondary" onClick={() => setDisableOpen(false)} disabled={submitting}>Cancel</Button><Button type="button" variant="destructive" onClick={() => void disable()} disabled={submitting || !disablePassword}>{submitting ? "Disabling…" : "Disable Protection"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CredentialFields(props: { username: string; setUsername: (value: string) => void; password: string; setPassword: (value: string) => void; confirmPassword: string; setConfirmPassword: (value: string) => void; showPasswords: boolean; setShowPasswords: (value: boolean) => void; errors: FieldErrors; passwordLabel: string; passwordAutoComplete: string }) {
  return <div className="space-y-4">
    <Field label="Username" htmlFor="protection-username" error={props.errors.username}><Input id="protection-username" autoComplete="username" value={props.username} onChange={(event) => props.setUsername(event.target.value)} /></Field>
    <Field label={props.passwordLabel} htmlFor="protection-password" error={props.errors.password}><PasswordInput id="protection-password" value={props.password} onChange={props.setPassword} visible={props.showPasswords} onToggle={() => props.setShowPasswords(!props.showPasswords)} autoComplete={props.passwordAutoComplete} /></Field>
    <Field label="Confirm password" htmlFor="protection-confirm-password" error={props.errors.confirmPassword}><PasswordInput id="protection-confirm-password" value={props.confirmPassword} onChange={props.setConfirmPassword} visible={props.showPasswords} onToggle={() => props.setShowPasswords(!props.showPasswords)} autoComplete={props.passwordAutoComplete} /></Field>
  </div>;
}

function PasswordInput({ id, value, onChange, visible, onToggle, autoComplete }: { id: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void; autoComplete: string }) {
  return <div className="relative"><Input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className="pr-12" /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>;
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={htmlFor}>{label}</Label>{children}{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</div>;
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", checked ? "bg-primary" : "bg-muted-foreground/30")}><span className={cn("absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-5")} /></button>;
}

function validate(updating: boolean, values: { username: string; password: string; confirmPassword: string; currentPassword: string }) {
  const errors: FieldErrors = {};
  if (!values.username.trim()) errors.username = "Username is required.";
  if (!updating || values.password) {
    if (values.password.length < 8) errors.password = "Password must be at least 8 characters.";
    if (values.password !== values.confirmPassword) errors.confirmPassword = "Passwords do not match.";
  } else if (values.confirmPassword) errors.confirmPassword = "Enter a new password first.";
  if (updating && !values.currentPassword) errors.currentPassword = "Current password is required.";
  return errors;
}

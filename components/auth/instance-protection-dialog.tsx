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
        <DialogContent className="max-w-[620px] gap-0 overflow-hidden rounded-2xl p-0">
          <div className="border-b border-border/70 bg-muted/20 px-5 py-4 pr-14">
            <DialogHeader className="space-y-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><LockKeyhole className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-base tracking-[-0.02em]">Login &amp; Protection</DialogTitle>
                    {status?.protectionEnabled ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300"><ShieldCheck className="h-3 w-3" />Protected</span> : null}
                  </div>
                  <DialogDescription className="mt-0.5 text-xs">Secure access to this AgentOS instance.</DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          {loading || !status ? (
            <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading protection settings…</div>
          ) : (
            <form onSubmit={submit} className="space-y-4 px-5 py-4">
              {!status.protectionEnabled ? (
                <>
                  <section className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-muted/35 px-3.5 py-3">
                    <div><p className="text-sm font-semibold">Enable protection</p><p className="mt-0.5 text-[11px] text-muted-foreground">Require credentials before opening AgentOS.</p></div>
                    <Switch checked={enabledSwitch} onChange={setEnabledSwitch} label="Enable Instance Protection" />
                  </section>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2"><Field label="Username" htmlFor="protection-username" error={errors.username}><CompactInput id="protection-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></Field></div>
                    <Field label="Password" htmlFor="protection-password" error={errors.password}><PasswordInput id="protection-password" value={password} onChange={setPassword} visible={showPasswords} onToggle={() => setShowPasswords(!showPasswords)} autoComplete="new-password" /></Field>
                    <Field label="Confirm password" htmlFor="protection-confirm-password" error={errors.confirmPassword}><PasswordInput id="protection-confirm-password" value={confirmPassword} onChange={setConfirmPassword} visible={showPasswords} onToggle={() => setShowPasswords(!showPasswords)} autoComplete="new-password" /></Field>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-3">
                    <p className="max-w-[330px] text-[11px] leading-4 text-muted-foreground">Protects this instance only. OpenClaw and workspace data stay unchanged.</p>
                    <Button type="submit" size="sm" disabled={submitting || !enabledSwitch}>{submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Save &amp; Enable</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-3">
                    <div><h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Account</h3><p className="mt-1 text-[11px] text-muted-foreground">Credential changes sign out other sessions.</p></div>
                    <Button type="submit" size="sm" disabled={submitting}>{submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Update Credentials</Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Username" htmlFor="protection-username" error={errors.username}><CompactInput id="protection-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></Field>
                    <Field label="Current password" htmlFor="protection-current-password" error={errors.currentPassword}><CompactInput id="protection-current-password" type={showPasswords ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
                    <Field label="New password (optional)" htmlFor="protection-password" error={errors.password}><PasswordInput id="protection-password" value={password} onChange={setPassword} visible={showPasswords} onToggle={() => setShowPasswords(!showPasswords)} autoComplete="new-password" /></Field>
                    <Field label="Confirm new password" htmlFor="protection-confirm-password" error={errors.confirmPassword}><PasswordInput id="protection-confirm-password" value={confirmPassword} onChange={setConfirmPassword} visible={showPasswords} onToggle={() => setShowPasswords(!showPasswords)} autoComplete="new-password" /></Field>
                  </div>

                  <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/25 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500"><ShieldCheck className="h-4 w-4" /></span><div><p className="text-xs font-semibold">Protection active</p><p className="text-[10px] text-muted-foreground">Signed session required</p></div></div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void lock()}><LockKeyhole className="mr-1.5 h-3.5 w-3.5" />Lock now</Button>
                      <Button type="button" size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => { setDisablePassword(""); setDisableError(null); setDisableOpen(true); }}><ShieldOff className="mr-1.5 h-3.5 w-3.5" />Disable</Button>
                    </div>
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

function PasswordInput({ id, value, onChange, visible, onToggle, autoComplete }: { id: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void; autoComplete: string }) {
  return <div className="relative"><CompactInput id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className="pr-10" /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button></div>;
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={htmlFor} className="text-[11px] font-medium text-muted-foreground">{label}</Label>{children}{error ? <p role="alert" className="text-[11px] text-destructive">{error}</p> : null}</div>;
}

function CompactInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className={cn("h-9 rounded-lg px-3 text-xs", props.className)} />;
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

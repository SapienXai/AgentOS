"use client";

import { useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

import { InstanceProtectionDialog } from "@/components/auth/instance-protection-dialog";
import { useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function SecuritySettings() {
  const { status } = useInstanceProtection();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isProtected = status?.protectionEnabled === true;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {isProtected ? <ShieldCheck className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">AgentOS account security</h2>
                <Badge variant={isProtected ? "success" : "muted"}>{isProtected ? "Protected" : "Not configured"}</Badge>
              </div>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                Manage the AgentOS password used for sign-in, lock, and unlock. OpenClaw Gateway credentials are managed separately in Connections.
              </p>
            </div>
          </div>
          <Button type="button" size="sm" variant="secondary" className="h-9 shrink-0" onClick={() => setDialogOpen(true)}>
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            {isProtected ? "Manage security" : "Set up protection"}
          </Button>
        </div>

        {isProtected ? (
          <div className="mt-4 grid gap-2 border-t border-border pt-4 text-xs sm:grid-cols-2">
            <div><span className="text-muted-foreground">Account</span><p className="mt-1 font-medium">@{status?.username}</p></div>
            <div><span className="text-muted-foreground">Password</span><p className="mt-1 font-medium">Set · change anytime</p></div>
          </div>
        ) : null}
      </section>

      <p className="flex items-start gap-2 px-1 text-[11px] leading-4 text-muted-foreground">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Locking keeps the current account context and requires that same account to unlock. Sign out ends the session and allows another account to sign in.
      </p>

      <InstanceProtectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

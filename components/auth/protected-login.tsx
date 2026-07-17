"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { broadcastAuthChange, useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProtectedLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, loading, applyStatus } = useInstanceProtection();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const storedTheme = localStorage.getItem("mission-control-surface-theme");
    document.documentElement.classList.toggle("dark", storedTheme !== "light");
    document.documentElement.style.colorScheme = storedTheme === "light" ? "light" : "dark";
  }, []);

  useEffect(() => {
    if (loading || !status) return;
    if (!status.protectionEnabled || status.authenticated) {
      router.replace(safeReturnTo(searchParams.get("returnTo")));
      return;
    }
    if (status.username) setUsername(status.username);
    queueMicrotask(() => usernameRef.current?.focus());
  }, [loading, router, searchParams, status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const payload = (await response.json()) as typeof status & { error?: string; retryAfterSeconds?: number };
      if (!response.ok || payload.error) {
        throw new Error(response.status === 429 ? "Too many login attempts. Try again later." : "Invalid username or password.");
      }
      applyStatus(payload);
      broadcastAuthChange();
      router.replace(safeReturnTo(searchParams.get("returnTo")));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid username or password.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !status || !status.protectionEnabled || status.authenticated) {
    return <AuthSplash />;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,hsl(var(--primary)/0.13),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))]" />
      <section className="relative w-full max-w-[420px] rounded-3xl border border-border/80 bg-card/95 p-6 shadow-[0_28px_90px_hsl(var(--foreground)/0.14)] backdrop-blur-xl sm:p-8" aria-labelledby="protected-title">
        <div className="mb-7 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background shadow-sm">
            <Image src="/assets/logo.webp" width={34} height={34} alt="AgentOS" priority />
          </span>
          <div>
            <p className="font-display text-base font-semibold tracking-[-0.02em]">AgentOS</p>
            <p className="text-xs text-muted-foreground">Instance Protection</p>
          </div>
          <LockKeyhole className="ml-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>

        <h1 id="protected-title" className="font-display text-2xl font-semibold tracking-[-0.035em]">AgentOS is Protected</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your credentials to access this AgentOS instance.</p>

        <form className="mt-7 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="instance-username">Username</Label>
            <Input ref={usernameRef} id="instance-username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required disabled={submitting} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instance-password">Password</Label>
            <div className="relative">
              <Input id="instance-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={submitting} className="pr-12" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={submitting || !username.trim() || !password}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
            {submitting ? "Unlocking…" : "Unlock AgentOS"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">Forgot your credentials? Run <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">agentos auth reset</code> on the machine running AgentOS.</p>
      </section>
    </main>
  );
}

function AuthSplash() {
  return <main className="flex min-h-screen items-center justify-center bg-background"><div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking protection…</div></main>;
}

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/";
}

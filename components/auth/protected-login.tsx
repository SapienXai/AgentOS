"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Server, ShieldCheck, UserRound } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { broadcastAuthChange, useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { CelestialLockBackground } from "@/components/auth/celestial-lock-background";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEADER_TAGLINES = [
  "AI Workforce OS",
  "Digital Workforce OS",
  "AI Operations Hub",
  "Agent Control Center",
  "Agent Command Center",
  "AI Workforce Manager",
  "Digital Worker Platform",
  "Autonomous Work Platform",
  "Agent Operations System",
  "Build AI Teams",
  "Run AI Teams",
  "Manage AI Workers",
  "Orchestrate AI Workers",
  "Your Digital Workforce",
  "Autonomy at Scale"
] as const;

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

  const returnTo = safeReturnTo(searchParams.get("returnTo"));

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <CelestialLockBackground />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,.13)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.13)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />

      <header className="relative z-10 mx-auto flex w-full max-w-[1180px] items-center justify-between px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <video src="/assets/logo.webm" autoPlay muted loop playsInline preload="auto" aria-label="AgentOS" className="h-11 w-11 shrink-0 object-contain" />
          <div className="text-white [text-shadow:0_1px_18px_rgba(2,6,23,.38)]">
            <p className="font-display text-sm font-semibold tracking-[-0.02em]">AgentOS</p>
            <AnimatedHeaderTagline />
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-white/20 bg-slate-950/25 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 shadow-sm backdrop-blur-xl sm:flex">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" /><span className="relative inline-flex h-2 w-2 rounded-full bg-primary" /></span>
          Instance locked
        </div>
      </header>

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] w-full max-w-[1180px] items-center gap-12 px-6 pb-10 sm:px-8 lg:grid-cols-[minmax(0,480px)_1fr] lg:gap-20 lg:pb-8">
        <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="-mt-4 w-full lg:mt-0" aria-labelledby="protected-title">
          <div className="mb-5 -translate-y-5 text-center text-white [text-shadow:0_2px_28px_rgba(2,6,23,.48)] lg:mb-4 lg:translate-y-0">
            <h1 id="protected-title" className="whitespace-nowrap font-display text-[clamp(1.85rem,8.5vw,2.1rem)] font-semibold leading-none tracking-[-0.06em] sm:text-[2.5rem] lg:text-[2.75rem]">AgentOS is Protected</h1>
            <p className="mx-auto mt-2 max-w-[430px] whitespace-nowrap text-xs leading-5 text-white/70 sm:text-sm">Unlock the control plane to access AgentOS.</p>
          </div>

          <Card className="lock-glass-card relative mt-12 rounded-[26px] p-5 pt-16 text-card-foreground lg:mt-0 lg:pt-5">
            <div className="absolute left-1/2 top-[-1px] z-10 h-[116px] w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-white/90 via-primary/45 to-sky-400/40 p-0.5 shadow-[0_0_22px_hsl(var(--primary)/0.28),0_20px_46px_hsl(var(--foreground)/0.20)] dark:from-white/30 dark:via-primary/50 dark:to-sky-400/35 lg:hidden">
              <div className="relative h-full w-full overflow-hidden rounded-full border border-white/70 bg-background shadow-[inset_0_0_18px_hsl(var(--foreground)/0.16)] dark:border-white/25">
                <video src="/assets/agentProfiles/piko.webm" autoPlay muted loop playsInline preload="auto" aria-label="Piko agent profile" className="h-full w-full object-cover" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_34%_24%,rgba(255,255,255,0.22),transparent_30%),linear-gradient(to_bottom,transparent_62%,hsl(var(--foreground)/0.12))]" />
              </div>
            </div>
            <CardHeader className="lock-glass-divider mb-4 flex-row items-center justify-between gap-4 border-b p-0 pb-3">
              <div><p className="text-sm font-semibold">Operator access</p><p className="mt-0.5 text-[11px] text-muted-foreground">Authenticate to unlock this session.</p></div>
              <span className="lock-glass-control flex size-9 items-center justify-center rounded-xl border text-muted-foreground"><KeyRound className="size-4" /></span>
            </CardHeader>

            <CardContent className="p-0">
              <form className="flex flex-col gap-3.5" onSubmit={submit}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="instance-username" className="text-[11px] font-medium text-muted-foreground">Username</Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input ref={usernameRef} id="instance-username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required disabled={submitting} className="lock-glass-input h-11 rounded-xl pl-10" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="instance-password" className="text-[11px] font-medium text-muted-foreground">Password</Label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="instance-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={submitting} className="lock-glass-input h-11 rounded-xl pl-10 pr-12" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {error ? <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.08] px-3 py-2.5 text-xs text-destructive">{error}</motion.p> : null}
                </AnimatePresence>

                <Button type="submit" className="group h-11 w-full rounded-xl" disabled={submitting || !username.trim() || !password}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
                  {submitting ? "Unlocking…" : "Unlock AgentOS"}
                  {!submitting ? <ArrowRight className="ml-auto h-4 w-4 transition-transform group-hover:translate-x-0.5" /> : null}
                </Button>
              </form>
            </CardContent>

            <CardFooter className="mt-4 flex items-center justify-between gap-3 p-0 text-[10px] text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5"><ArrowRight className="h-3 w-3 shrink-0" /><span className="truncate">Return to {formatReturnPath(returnTo)}</span></span>
              <span className="shrink-0">12h session</span>
            </CardFooter>
          </Card>

          <div className="mt-3 px-1 text-center text-[10px] leading-4 text-white/70 [text-shadow:0_1px_12px_rgba(2,6,23,.55)]">
            <p className="lg:whitespace-nowrap">Forgot your credentials? Run <code className="rounded-md border border-white/20 bg-slate-950/20 px-1.5 py-0.5 text-white">agentos auth reset</code> on the machine running AgentOS.</p>
          </div>
        </motion.section>

        <VaultVisual />
      </div>
    </main>
  );
}

function VaultVisual() {
  return (
    <motion.aside initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.08, duration: 0.55, ease: [0.22, 1, 0.36, 1] }} className="relative hidden min-h-[560px] items-center justify-center lg:flex" aria-label="AgentOS instance security">
      <div aria-hidden="true" className="absolute h-[510px] w-[510px] rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.17),hsl(215_100%_68%/0.08)_38%,transparent_70%)] blur-2xl dark:bg-[radial-gradient(circle,hsl(var(--primary)/0.22),hsl(215_100%_58%/0.10)_42%,transparent_72%)]" />
      <div aria-hidden="true" className="absolute h-[300px] w-[300px] rounded-full bg-white/25 blur-[80px] dark:bg-primary/10" />
      <div className="relative flex h-[430px] w-[430px] items-center justify-center">
        <motion.div aria-hidden="true" animate={{ rotate: 360 }} transition={{ duration: 34, ease: "linear", repeat: Infinity }} className="absolute inset-0 rounded-full border border-dashed border-border/70">
          <span className="absolute left-1/2 top-[-5px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_32%_28%,white_0%,hsl(var(--primary))_38%,hsl(var(--primary)/0.68)_76%)] shadow-[0_0_7px_hsl(var(--primary)/0.95),0_0_24px_hsl(var(--primary)/0.62)] ring-1 ring-white/70 dark:ring-white/35" />
        </motion.div>
        <motion.div aria-hidden="true" initial={{ rotate: 132 }} animate={{ rotate: -228 }} transition={{ duration: 17, ease: "linear", repeat: Infinity }} className="absolute inset-[24px] rounded-full border border-amber-400/10">
          <span className="absolute left-1/2 top-[-6px] h-3 w-3 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_32%_28%,#fff7cc_0%,#fbbf24_38%,#d97706_78%)] shadow-[0_0_8px_rgba(251,191,36,0.95),0_0_26px_rgba(251,191,36,0.58)] ring-1 ring-white/70 dark:ring-white/35" />
        </motion.div>
        <motion.div aria-hidden="true" initial={{ rotate: 68 }} animate={{ rotate: 428 }} transition={{ duration: 25, ease: "linear", repeat: Infinity }} className="absolute inset-[48px] rounded-full border border-border/80">
          <span className="absolute left-1/2 top-[-4px] h-2 w-2 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ffffff_0%,#94a3b8_42%,#475569_82%)] shadow-[0_0_6px_rgba(148,163,184,0.9),0_0_18px_rgba(100,116,139,0.5)] ring-1 ring-white/60 dark:ring-white/30" />
        </motion.div>
        <motion.div aria-hidden="true" initial={{ rotate: 214 }} animate={{ rotate: 574 }} transition={{ duration: 29, ease: "linear", repeat: Infinity }} className="absolute inset-[72px] rounded-full border border-emerald-400/10">
          <span className="absolute left-1/2 top-[-4px] h-2 w-2 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_32%_28%,#d1fae5_0%,#34d399_40%,#059669_80%)] shadow-[0_0_7px_rgba(52,211,153,0.95),0_0_20px_rgba(16,185,129,0.55)] ring-1 ring-white/65 dark:ring-white/30" />
        </motion.div>
        <motion.div aria-hidden="true" initial={{ rotate: 302 }} animate={{ rotate: -58 }} transition={{ duration: 13, ease: "linear", repeat: Infinity }} className="absolute inset-[84px] rounded-full border border-sky-400/10">
          <span className="absolute left-1/2 top-[-3px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_32%_28%,#e0f2fe_0%,#38bdf8_40%,#2563eb_82%)] shadow-[0_0_6px_rgba(56,189,248,0.98),0_0_18px_rgba(37,99,235,0.58)] ring-1 ring-white/65 dark:ring-white/30" />
        </motion.div>
        <div aria-hidden="true" className="absolute inset-[96px] rounded-full border border-primary/20 bg-card/40 shadow-[inset_0_0_70px_hsl(var(--primary)/0.06)] backdrop-blur-sm" />

        <div className="relative z-10 h-[196px] w-[196px] rounded-full bg-gradient-to-br from-white/80 via-primary/35 to-sky-400/35 p-0.5 shadow-[0_0_20px_hsl(var(--primary)/0.20),0_26px_76px_hsl(var(--foreground)/0.16)] dark:from-white/30 dark:via-primary/45 dark:to-sky-400/30">
          <div className="relative h-full w-full overflow-hidden rounded-full border border-white/70 bg-background shadow-[inset_0_0_28px_hsl(var(--foreground)/0.18)] dark:border-white/25">
            <video src="/assets/agentProfiles/piko.webm" autoPlay muted loop playsInline preload="auto" aria-label="Piko agent profile" className="h-full w-full object-cover" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_34%_24%,rgba(255,255,255,0.22),transparent_28%),linear-gradient(to_bottom,transparent_62%,hsl(var(--foreground)/0.12))] shadow-[inset_0_0_20px_rgba(255,255,255,0.18)]" />
          </div>
        </div>

        <OrbitingVaultLabel phase={-65} icon={Server} label="Local instance" />
        <OrbitingVaultLabel phase={55} icon={KeyRound} label="Hashed credential" />
        <OrbitingVaultLabel phase={175} icon={ShieldCheck} label="Signed session" />
      </div>
    </motion.aside>
  );
}

function OrbitingVaultLabel({ phase, icon: Icon, label }: { phase: number; icon: typeof Server; label: string }) {
  const orbitTransition = { duration: 58, ease: "linear" as const, repeat: Infinity };

  return (
    <motion.div initial={{ rotate: phase }} animate={{ rotate: phase + 360 }} transition={orbitTransition} className="pointer-events-none absolute inset-[30px] z-20 rounded-full">
      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
        <motion.div initial={{ rotate: -phase }} animate={{ rotate: -phase - 360 }} transition={orbitTransition}>
          <div className="lock-glass-chip flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-[10px] font-medium">
            <Icon className="h-3.5 w-3.5 text-primary" />{label}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function AnimatedHeaderTagline() {
  const reduceMotion = useReducedMotion();
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [visibleText, setVisibleText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;

    const phrase = HEADER_TAGLINES[phraseIndex];
    const finishedTyping = !deleting && visibleText === phrase;
    const finishedDeleting = deleting && visibleText.length === 0;
    const delay = finishedTyping ? 1450 : finishedDeleting ? 260 : deleting ? 24 : 48;

    const timer = window.setTimeout(() => {
      if (finishedTyping) {
        setDeleting(true);
      } else if (finishedDeleting) {
        setPhraseIndex((current) => (current + 1) % HEADER_TAGLINES.length);
        setDeleting(false);
      } else {
        setVisibleText(phrase.slice(0, visibleText.length + (deleting ? -1 : 1)));
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [deleting, phraseIndex, reduceMotion, visibleText]);

  return (
    <p aria-label="AI workforce operating system" className="flex h-3.5 w-[138px] items-center overflow-hidden whitespace-nowrap text-[9px] tracking-[0.12em] text-white/55 [text-shadow:0_1px_12px_rgba(2,6,23,.45)] sm:w-[170px]">
      <span aria-hidden="true">{reduceMotion ? HEADER_TAGLINES[0] : visibleText}</span>
      <motion.span aria-hidden="true" animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.9, 0.2, 0.9] }} transition={{ duration: 0.8, ease: "easeInOut", repeat: Infinity }} className="ml-1 h-2.5 w-px shrink-0 bg-white/70" />
    </p>
  );
}

function AuthSplash() {
  return <main className="flex min-h-screen items-center justify-center bg-background"><div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking protection…</div></main>;
}

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/";
}

function formatReturnPath(value: string) {
  if (value === "/") return "Mission Control";
  const path = value.split("?")[0]?.split("#")[0] || "/";
  return path.length > 34 ? `${path.slice(0, 31)}…` : path;
}

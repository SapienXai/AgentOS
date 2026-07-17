"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  Boxes,
  CalendarClock,
  Camera,
  FileText,
  ListTodo,
  Loader2,
  Radio,
  Save,
  UserRound
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { OperationsSnapshot } from "@/lib/agentos/operations/types";
import type { WorkspaceManagedFileReadResponse } from "@/lib/openclaw/workspace-file-types";
import { cn } from "@/lib/utils";

export type OperatorProfileSummary = {
  fullName: string;
  username: string;
  email: string;
  avatarDataUrl: string | null;
};

type OperatorProfileResponse = OperatorProfileSummary & {
  updatedAt: string | null;
  error?: string;
};

type ProfileDraft = Pick<OperatorProfileResponse, "fullName" | "username" | "email" | "avatarDataUrl"> & {
  userMarkdown: string;
};

type FieldErrors = Partial<Record<"fullName" | "username" | "email" | "userMarkdown" | "avatar", string>>;

const emptyDraft: ProfileDraft = {
  fullName: "",
  username: "",
  email: "",
  avatarDataUrl: null,
  userMarkdown: ""
};
const avatarMaxBytes = 512 * 1024;

export function UserProfileDialog({
  open,
  onOpenChange,
  snapshot,
  activeWorkspaceId,
  onProfileSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  onProfileSaved?: (profile: OperatorProfileSummary) => void;
}) {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [savedDraft, setSavedDraft] = useState<ProfileDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationsError, setOperationsError] = useState<string | null>(null);
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null);
  const [maxUserFileBytes, setMaxUserFileBytes] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const workspaceId = activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null;
  const hasUnsavedChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(savedDraft), [draft, savedDraft]);

  const loadProfile = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    setOperationsError(null);
    setOperations(null);
    setFieldErrors({});

    try {
      const profileRequest = fetch("/api/profile", { cache: "no-store", signal });
      const userFileRequest = workspaceId
        ? fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files?path=USER.md`, {
            cache: "no-store",
            signal
          })
        : null;
      const operationsRequest = fetch("/api/operations", { cache: "no-store", signal })
        .then(async (response) => {
          const result = (await response.json()) as OperationsSnapshot & { error?: string };
          if (!response.ok || result.error) {
            throw new Error(result.error || "Operation metrics could not be loaded.");
          }
          return result;
        })
        .then(setOperations)
        .catch((error: unknown) => {
          if (!signal.aborted) {
            setOperationsError(error instanceof Error ? error.message : "Operation metrics are unavailable.");
          }
        });

      const profileResponse = await profileRequest;
      const profile = (await profileResponse.json()) as OperatorProfileResponse;
      if (!profileResponse.ok || profile.error) {
        throw new Error(profile.error || "Profile details could not be loaded.");
      }

      let userMarkdown = "";
      let userFileMaxBytes: number | null = null;
      if (userFileRequest) {
        const userFileResponse = await userFileRequest;
        const userFile = (await userFileResponse.json()) as WorkspaceManagedFileReadResponse & { error?: string };
        if (!userFileResponse.ok || userFile.error) {
          throw new Error(userFile.error || "USER.md could not be loaded.");
        }
        userMarkdown = userFile.content;
        userFileMaxBytes = userFile.maxFileBytes;
      }

      const nextDraft: ProfileDraft = {
        fullName: profile.fullName,
        username: profile.username,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl,
        userMarkdown
      };
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setMaxUserFileBytes(userFileMaxBytes);
      await operationsRequest;
    } catch (error) {
      if (!signal.aborted) {
        setLoadError(error instanceof Error ? error.message : "The user profile could not be loaded.");
      }
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile, open]);

  useEffect(() => {
    if (!open || !hasUnsavedChanges) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, open]);

  const requestClose = useCallback(() => {
    if (isSaving) {
      return false;
    }
    if (hasUnsavedChanges && !window.confirm("Discard unsaved profile changes?")) {
      return false;
    }
    onOpenChange(false);
    return true;
  }, [hasUnsavedChanges, isSaving, onOpenChange]);

  const validate = useCallback(() => {
    const nextErrors: FieldErrors = {};
    if (draft.fullName.trim().length < 2) {
      nextErrors.fullName = "Enter at least 2 characters.";
    }
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/.test(draft.username.trim().toLowerCase())) {
      nextErrors.username = "Use 2–40 lowercase letters, numbers, dots, dashes, or underscores.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (maxUserFileBytes && new Blob([draft.userMarkdown]).size > maxUserFileBytes) {
      nextErrors.userMarkdown = `USER.md exceeds ${formatFileSize(maxUserFileBytes)}.`;
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [draft, maxUserFileBytes]);

  const saveChanges = useCallback(async () => {
    if (!validate()) {
      return;
    }

    setIsSaving(true);
    setLoadError(null);
    try {
      const profileResponse = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: draft.fullName,
          username: draft.username,
          email: draft.email,
          avatarDataUrl: draft.avatarDataUrl
        })
      });
      const profile = (await profileResponse.json()) as OperatorProfileResponse;
      if (!profileResponse.ok || profile.error) {
        throw new Error(profile.error || "Profile details could not be saved.");
      }

      if (workspaceId) {
        const userFileResponse = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "USER.md", content: draft.userMarkdown })
        });
        const userFile = (await userFileResponse.json()) as WorkspaceManagedFileReadResponse & { error?: string };
        if (!userFileResponse.ok || userFile.error) {
          throw new Error(`Profile identity was saved, but USER.md failed: ${userFile.error || "Unknown error."}`);
        }
      }

      const normalizedDraft = {
        ...draft,
        fullName: profile.fullName,
        username: profile.username,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl
      };
      setDraft(normalizedDraft);
      setSavedDraft(normalizedDraft);
      setFieldErrors({});
      onProfileSaved?.({
        fullName: profile.fullName,
        username: profile.username,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl
      });
      toast.success("Profile changes saved.", {
        description: workspace ? `Operator identity and ${workspace.name}/USER.md are up to date.` : "Operator identity is up to date."
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Profile changes could not be saved.";
      setLoadError(message);
      toast.error("Profile save failed.", { description: message });
    } finally {
      setIsSaving(false);
    }
  }, [draft, onProfileSaved, validate, workspace, workspaceId]);

  const handlePhotoChange = useCallback((file: File | undefined) => {
    if (!file) {
      return;
    }
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
      setFieldErrors((current) => ({ ...current, avatar: "Choose a PNG, JPEG, or WebP image." }));
      return;
    }
    if (file.size > avatarMaxBytes) {
      setFieldErrors((current) => ({ ...current, avatar: "Photo must be 512 KB or smaller." }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDraft((current) => ({ ...current, avatarDataUrl: reader.result as string }));
        setFieldErrors((current) => ({ ...current, avatar: undefined }));
      }
    };
    reader.onerror = () => setFieldErrors((current) => ({ ...current, avatar: "Photo could not be read." }));
    reader.readAsDataURL(file);
  }, []);

  const metrics = useMemo(() => {
    const activeTasks = snapshot.tasks.filter((task) => task.status === "running" || task.status === "queued").length;
    const activeJobs = operations?.jobs.filter((job) => job.enabled && ["active", "scheduled", "running"].includes(job.status)).length;
    const liveOperations = operations?.runs.filter((run) => run.status === "running" || run.status === "queued").length;
    return [
      { label: "Managed Agents", value: snapshot.agents.length, icon: Bot },
      { label: "Workspaces", value: snapshot.workspaces.length, icon: Boxes },
      { label: "Active Tasks", value: activeTasks, icon: ListTodo },
      { label: "Active Jobs", value: activeJobs, icon: CalendarClock },
      { label: "Live Operations", value: liveOperations, icon: Radio }
    ];
  }, [operations, snapshot.agents.length, snapshot.tasks, snapshot.workspaces.length]);

  const initials = getInitials(draft.fullName || draft.username);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}>
      <DialogContent
        className="grid max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[760px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[20px] border-border bg-popover p-0 text-popover-foreground shadow-2xl sm:max-h-[calc(100dvh-48px)]"
        onInteractOutside={(event) => isSaving && event.preventDefault()}
        onEscapeKeyDown={(event) => isSaving && event.preventDefault()}
      >
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 pr-14 sm:px-6">
          <DialogTitle className="text-lg tracking-[-0.02em]">User Profile</DialogTitle>
          <DialogDescription className="text-xs">
            Manage your operator identity and the context AgentOS shares with OpenClaw.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
          {isLoading ? (
            <ProfileLoadingState />
          ) : (
            <form id="user-profile-form" onSubmit={(event) => { event.preventDefault(); void saveChanges(); }} className="space-y-4">
              {loadError ? (
                <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.06] px-3 py-2.5 text-xs text-destructive">
                  <span>{loadError}</span>
                  <button type="button" className="shrink-0 font-semibold underline-offset-2 hover:underline" onClick={() => void loadProfile(new AbortController().signal)}>Retry</button>
                </div>
              ) : null}

              <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    <Avatar className="h-16 w-16 rounded-2xl border-border bg-muted shadow-sm">
                      {draft.avatarDataUrl ? <AvatarImage src={draft.avatarDataUrl} alt={`${draft.fullName || "User"} profile photo`} className="object-cover" /> : null}
                      <AvatarFallback className="rounded-2xl bg-primary/10 font-display text-base font-semibold text-primary">
                        {initials || <UserRound className="h-5 w-5" />}
                      </AvatarFallback>
                    </Avatar>
                    <button
                      type="button"
                      aria-label="Change profile photo"
                      onClick={() => photoInputRef.current?.click()}
                      className="absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-popover text-foreground shadow-md outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{draft.fullName || "Your operator profile"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">PNG, JPEG or WebP · max 512 KB</p>
                    {fieldErrors.avatar ? <p className="mt-1 text-[11px] text-destructive">{fieldErrors.avatar}</p> : null}
                  </div>
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => { handlePhotoChange(event.target.files?.[0]); event.currentTarget.value = ""; }}
                />
                <Button type="button" variant="secondary" size="sm" className="h-8 self-start px-3 text-xs sm:self-auto" onClick={() => photoInputRef.current?.click()}>
                  <Camera className="mr-1.5 h-3.5 w-3.5" />
                  Change Photo
                </Button>
              </section>

              <div className="grid gap-3 sm:grid-cols-3">
                <ProfileField label="Full Name" error={fieldErrors.fullName}>
                  <Input value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} autoComplete="name" className="h-9 px-3 text-xs" placeholder="Your full name" aria-invalid={Boolean(fieldErrors.fullName)} />
                </ProfileField>
                <ProfileField label="Username" error={fieldErrors.username}>
                  <Input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value.toLowerCase() }))} autoComplete="username" className="h-9 px-3 text-xs" placeholder="username" aria-invalid={Boolean(fieldErrors.username)} />
                </ProfileField>
                <ProfileField label="Email" error={fieldErrors.email}>
                  <Input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} autoComplete="email" className="h-9 px-3 text-xs" placeholder="you@example.com" aria-invalid={Boolean(fieldErrors.email)} />
                </ProfileField>
              </div>

              <section className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="mb-2.5 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Label htmlFor="user-markdown" className="text-xs font-semibold">USER.md</Label>
                        {workspace ? <span className="rounded-md bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{workspace.name}</span> : null}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        Stable preferences and working context loaded by OpenClaw for this workspace.
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">Markdown</span>
                </div>
                <Textarea
                  id="user-markdown"
                  value={draft.userMarkdown}
                  onChange={(event) => setDraft((current) => ({ ...current, userMarkdown: event.target.value }))}
                  disabled={!workspaceId}
                  aria-invalid={Boolean(fieldErrors.userMarkdown)}
                  className="h-36 min-h-36 resize-none overflow-y-auto bg-background px-3 py-2.5 font-mono text-[11px] leading-5"
                  placeholder={workspaceId ? "Add durable preferences, context, and collaboration guidance…" : "Create or select a workspace to edit USER.md."}
                />
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                  <span>{fieldErrors.userMarkdown || (workspaceId ? "Saved to the active workspace root." : "No workspace is available.")}</span>
                  <span>{formatFileSize(new Blob([draft.userMarkdown]).size)}{maxUserFileBytes ? ` / ${formatFileSize(maxUserFileBytes)}` : ""}</span>
                </div>
              </section>

              <section aria-label="User statistics" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {metrics.map((metric) => (
                  <ProfileMetric key={metric.label} {...metric} unavailable={(metric.label === "Active Jobs" || metric.label === "Live Operations") && Boolean(operationsError)} />
                ))}
              </section>
              {operationsError ? <p className="text-[10px] text-muted-foreground">OpenClaw operation metrics are unavailable: {operationsError}</p> : null}
            </form>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-border bg-muted/20 px-5 py-3 sm:px-6">
          <Button type="button" variant="ghost" size="sm" className="mr-auto h-8 px-2.5 text-xs" onClick={() => { if (requestClose()) router.push("/operations"); }}>
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            View Activity
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" className="h-8 px-3 text-xs" disabled={isSaving} onClick={requestClose}>Cancel</Button>
            <Button form="user-profile-form" type="submit" size="sm" className="h-8 px-3 text-xs" disabled={isLoading || isSaving || Boolean(loadError) || !hasUnsavedChanges}>
              {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              {isSaving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}

function ProfileMetric({
  label,
  value,
  icon: Icon,
  unavailable
}: {
  label: string;
  value: number | undefined;
  icon: typeof Bot;
  unavailable: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-2 shadow-sm">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
        <Icon className={cn("h-3.5 w-3.5", label === "Live Operations" && !unavailable && value ? "animate-pulse" : "")} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-4 text-foreground">{unavailable ? "—" : value ?? 0}</span>
        <span className="block truncate text-[9px] leading-3 text-muted-foreground" title={label}>{label}</span>
      </span>
    </div>
  );
}

function ProfileLoadingState() {
  return (
    <div className="space-y-4" aria-label="Loading user profile" aria-busy="true">
      <div className="flex items-center gap-3"><div className="h-16 w-16 animate-pulse rounded-2xl bg-muted" /><div className="space-y-2"><div className="h-3 w-36 animate-pulse rounded bg-muted" /><div className="h-2.5 w-24 animate-pulse rounded bg-muted" /></div></div>
      <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-muted" />)}</div>
    </div>
  );
}

function getInitials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

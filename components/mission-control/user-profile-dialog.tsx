"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Save, ShieldCheck, UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

export type OperatorProfileSummary = {
  fullName: string;
  username: string;
  email: string;
  avatarDataUrl: string | null;
  actorId?: string | null;
  role?: "owner" | "member" | null;
  status?: "active" | "disabled" | null;
};

type OperatorProfileResponse = OperatorProfileSummary & { updatedAt: string | null; error?: string };
type ProfileDraft = Pick<OperatorProfileResponse, "fullName" | "username" | "email" | "avatarDataUrl">;
type FieldErrors = Partial<Record<"fullName" | "email" | "avatar", string>>;

const emptyDraft: ProfileDraft = { fullName: "", username: "", email: "", avatarDataUrl: null };
const avatarMaxBytes = 512 * 1024;

export function UserProfileDialog({
  open,
  onOpenChange,
  onProfileSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileSaved?: (profile: OperatorProfileSummary) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [savedDraft, setSavedDraft] = useState<ProfileDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profileMeta, setProfileMeta] = useState<Pick<OperatorProfileResponse, "role" | "status"> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  const loadProfile = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    setFieldErrors({});
    try {
      const response = await fetch("/api/profile", { cache: "no-store", signal });
      const profile = (await response.json()) as OperatorProfileResponse;
      if (!response.ok || profile.error) throw new Error(profile.error || "Profile details could not be loaded.");
      const nextDraft: ProfileDraft = {
        fullName: profile.fullName,
        username: profile.username,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl
      };
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setProfileMeta({ role: profile.role, status: profile.status });
    } catch (error) {
      if (!signal.aborted) setLoadError(error instanceof Error ? error.message : "The profile could not be loaded.");
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile, open]);

  const requestClose = useCallback(() => {
    if (isSaving) return false;
    if (hasUnsavedChanges && !window.confirm("Discard unsaved profile changes?")) return false;
    onOpenChange(false);
    return true;
  }, [hasUnsavedChanges, isSaving, onOpenChange]);

  const validate = useCallback(() => {
    const nextErrors: FieldErrors = {};
    if (draft.fullName.trim().length < 2) nextErrors.fullName = "Enter at least 2 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) nextErrors.email = "Enter a valid email address.";
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [draft.email, draft.fullName]);

  const saveChanges = useCallback(async () => {
    if (!validate()) return;
    setIsSaving(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const profile = (await response.json()) as OperatorProfileResponse;
      if (!response.ok || profile.error) throw new Error(profile.error || "Profile details could not be saved.");
      const normalizedDraft: ProfileDraft = {
        fullName: profile.fullName,
        username: profile.username,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl
      };
      setDraft(normalizedDraft);
      setSavedDraft(normalizedDraft);
      setProfileMeta({ role: profile.role, status: profile.status });
      setFieldErrors({});
      onProfileSaved?.({
        fullName: profile.fullName,
        username: profile.username,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl,
        role: profile.role,
        status: profile.status
      });
      toast.success("Profile changes saved.", { description: "Your AgentOS identity is up to date." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Profile changes could not be saved.";
      setLoadError(message);
      toast.error("Profile save failed.", { description: message });
    } finally {
      setIsSaving(false);
    }
  }, [draft, onProfileSaved, validate]);

  const handlePhotoChange = useCallback((file: File | undefined) => {
    if (!file) return;
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

  const initials = getInitials(draft.fullName || draft.username);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}>
      <DialogContent
        className="grid max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[560px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[20px] border-border bg-popover p-0 text-popover-foreground shadow-2xl sm:max-h-[calc(100dvh-48px)]"
        onInteractOutside={(event) => isSaving && event.preventDefault()}
        onEscapeKeyDown={(event) => isSaving && event.preventDefault()}
      >
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 pr-14 sm:px-6">
          <DialogTitle className="text-lg tracking-[-0.02em]">Profile</DialogTitle>
          <DialogDescription className="text-xs">Manage the human identity you use in AgentOS.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
          {isLoading ? (
            <ProfileLoadingState />
          ) : (
            <form id="user-profile-form" onSubmit={(event) => { event.preventDefault(); void saveChanges(); }} className="space-y-5">
              {loadError ? (
                <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.06] px-3 py-2.5 text-xs text-destructive">
                  <span>{loadError}</span>
                  <button type="button" className="shrink-0 font-semibold underline-offset-2 hover:underline" onClick={() => void loadProfile(new AbortController().signal)}>Retry</button>
                </div>
              ) : null}

              <section className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="relative">
                    <Avatar className="h-16 w-16 rounded-2xl border-border bg-muted shadow-sm">
                      {draft.avatarDataUrl ? <AvatarImage src={draft.avatarDataUrl} alt={`${draft.fullName || "User"} profile photo`} className="object-cover" /> : null}
                      <AvatarFallback className="rounded-2xl bg-primary/10 font-display text-base font-semibold text-primary">{initials || <UserRound className="h-5 w-5" />}</AvatarFallback>
                    </Avatar>
                    <button type="button" aria-label="Change profile photo" onClick={() => photoInputRef.current?.click()} className="absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-popover text-foreground shadow-md outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"><Camera className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{draft.fullName || "Your profile"}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{draft.email || "Add an email address"}</p>
                    {fieldErrors.avatar ? <p className="mt-1 text-[11px] text-destructive">{fieldErrors.avatar}</p> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {profileMeta?.role ? <Badge variant="muted" className="capitalize">{profileMeta.role}</Badge> : null}
                  {profileMeta?.status === "active" ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Active account" /> : null}
                </div>
                <input ref={photoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { handlePhotoChange(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </section>

              <div className="grid gap-3 sm:grid-cols-2">
                <ProfileField label="Full name" error={fieldErrors.fullName}>
                  <Input value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} autoComplete="name" className="h-9 px-3 text-xs" placeholder="Your full name" aria-invalid={Boolean(fieldErrors.fullName)} />
                </ProfileField>
                <ProfileField label="Email" error={fieldErrors.email}>
                  <Input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} autoComplete="email" className="h-9 px-3 text-xs" placeholder="you@example.com" aria-invalid={Boolean(fieldErrors.email)} />
                </ProfileField>
                <ProfileField label="Username" hint="Managed in Settings → Security.">
                  <Input value={draft.username} readOnly disabled autoComplete="username" className="h-9 px-3 text-xs opacity-75" />
                </ProfileField>
              </div>
            </form>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3 sm:px-6">
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={requestClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" form="user-profile-form" size="sm" className="h-8 px-3 text-xs" disabled={isLoading || isSaving || !hasUnsavedChanges}>
            {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileField({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>{children}{error ? <p role="alert" className="text-[10px] text-destructive">{error}</p> : hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}</div>;
}

function ProfileLoadingState() {
  return <div className="space-y-5" aria-label="Loading user profile" aria-busy="true"><div className="flex items-center gap-3"><div className="h-16 w-16 animate-pulse rounded-2xl bg-muted" /><div className="space-y-2"><div className="h-3 w-36 animate-pulse rounded bg-muted" /><div className="h-2.5 w-24 animate-pulse rounded bg-muted" /></div></div><div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div></div>;
}

function getInitials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

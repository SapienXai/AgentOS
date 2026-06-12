"use client";

import { useCallback, useEffect, useState } from "react";

import type { WorkspaceDialogSection } from "@/components/mission-control/workspace-channels-dialog";
import type { ConnectBrowserProfileInput } from "@/components/operations/accounts/accounts-page-content";
import { toast } from "@/components/ui/sonner";
import type {
  AccountAccessRulesResponse,
  AccountAccessRuleView
} from "@/lib/agentos/account-access-policy-types";
import type {
  AccountLoginTargetsResponse,
  AccountLoginTargetView
} from "@/lib/agentos/account-login-target-types";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  OpenClawBrowserProfileMutationResponse,
  OpenClawBrowserProfilesResponse,
  OpenClawBrowserProfileView
} from "@/lib/openclaw/browser-profile-types";

type WorkspaceRecord = MissionControlSnapshot["workspaces"][number];

export function useMissionControlWorkspaceActions({
  activeWorkspace,
  openWorkspaceOnCanvas
}: {
  activeWorkspace: WorkspaceRecord | null;
  openWorkspaceOnCanvas: (workspaceId: string | null) => void;
}) {
  const [isWorkspaceWizardOpen, setIsWorkspaceWizardOpen] = useState(false);
  const [workspaceWizardInitialMode, setWorkspaceWizardInitialMode] = useState<"basic" | "advanced">("basic");
  const [workspaceWizardEditId, setWorkspaceWizardEditId] = useState<string | null>(null);
  const [isWorkspaceChannelsOpen, setIsWorkspaceChannelsOpen] = useState(false);
  const [workspaceChannelsInitialAgentId, setWorkspaceChannelsInitialAgentId] = useState<string | null>(null);
  const [workspaceChannelsInitialSection, setWorkspaceChannelsInitialSection] = useState<WorkspaceDialogSection>("surfaces");
  const [isConnectAccountDialogOpen, setIsConnectAccountDialogOpen] = useState(false);
  const [accountBrowserProfiles, setAccountBrowserProfiles] = useState<OpenClawBrowserProfileView[]>([]);
  const [accountTargets, setAccountTargets] = useState<AccountLoginTargetView[]>([]);
  const [accountAccessRules, setAccountAccessRules] = useState<AccountAccessRuleView[]>([]);
  const [workspaceFilesDialogId, setWorkspaceFilesDialogId] = useState<string | null>(null);

  const openWorkspaceWizard = useCallback((mode: "basic" | "advanced" = "basic") => {
    setWorkspaceWizardEditId(null);
    setWorkspaceWizardInitialMode(mode);
    setIsWorkspaceWizardOpen(true);
  }, []);

  const openWorkspaceWizardForEdit = useCallback((workspaceId: string) => {
    setWorkspaceWizardEditId(workspaceId);
    setWorkspaceWizardInitialMode("advanced");
    setIsWorkspaceWizardOpen(true);
  }, []);

  const handleWorkspaceWizardOpenChange = useCallback((nextOpen: boolean) => {
    setIsWorkspaceWizardOpen(nextOpen);

    if (!nextOpen) {
      setWorkspaceWizardEditId(null);
      setWorkspaceWizardInitialMode("basic");
    }
  }, []);

  const loadAccountBindings = useCallback(async () => {
    try {
      const [targetsResponse, rulesResponse] = await Promise.all([
        fetch("/api/accounts/login-targets", { cache: "no-store" }),
        fetch("/api/accounts/access-rules", { cache: "no-store" })
      ]);
      const targetsPayload = await targetsResponse.json().catch(() => null) as AccountLoginTargetsResponse | null;
      const rulesPayload = await rulesResponse.json().catch(() => null) as AccountAccessRulesResponse | null;

      if (targetsResponse.ok && targetsPayload?.ok) {
        setAccountTargets(targetsPayload.targets);
      }

      if (rulesResponse.ok && rulesPayload?.ok) {
        setAccountAccessRules(rulesPayload.rules);
      }
    } catch {
      setAccountTargets([]);
      setAccountAccessRules([]);
    }
  }, []);

  const loadAccountBrowserProfiles = useCallback(async () => {
    try {
      const response = await fetch("/api/accounts/browser-profiles", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as OpenClawBrowserProfilesResponse | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Unable to read OpenClaw browser profiles.");
      }

      setAccountBrowserProfiles(payload.profiles);
    } catch (error) {
      setAccountBrowserProfiles([]);
      toast.error("Unable to read OpenClaw browser profiles.", {
        description: readBrowserProfileError(error, "OpenClaw did not return browser profiles.")
      });
    }
  }, []);

  useEffect(() => {
    void loadAccountBindings();
  }, [loadAccountBindings]);

  const openWorkspaceChannels = useCallback((workspaceId?: string, agentId?: string, section: WorkspaceDialogSection = "surfaces") => {
    if (workspaceId) {
      openWorkspaceOnCanvas(workspaceId);
    }

    setWorkspaceChannelsInitialAgentId(agentId ?? null);
    setWorkspaceChannelsInitialSection(section);
    setIsWorkspaceChannelsOpen(true);
    void loadAccountBindings();
  }, [loadAccountBindings, openWorkspaceOnCanvas]);

  const openAccountsConnect = useCallback((workspaceId?: string, agentId?: string) => {
    openWorkspaceChannels(workspaceId, agentId, "accounts");
  }, [openWorkspaceChannels]);

  const openConnectAccountDialog = useCallback(() => {
    setIsConnectAccountDialogOpen(true);
    void loadAccountBrowserProfiles();
  }, [loadAccountBrowserProfiles]);

  const connectAccount = useCallback(async (input: ConnectBrowserProfileInput) => {
    if (!activeWorkspace) {
      toast.error("Select a workspace before connecting an account.");
      return;
    }

    try {
      const profileResponse = await fetch("/api/accounts/browser-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open-login",
          profileName: input.profileName,
          loginUrl: input.loginUrl,
          label: input.label
        })
      });
      const profilePayload = await profileResponse.json().catch(() => null) as OpenClawBrowserProfileMutationResponse | null;

      if (!profileResponse.ok || !profilePayload?.ok) {
        throw new Error(profilePayload?.error ?? "Unable to open the login URL in OpenClaw.");
      }

      const targetResponse = await fetch("/api/accounts/login-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspace.id,
          workspaceName: activeWorkspace.name,
          workspacePath: activeWorkspace.path ?? null,
          serviceId: input.serviceId,
          serviceName: input.serviceName,
          primaryDomain: input.primaryDomain,
          loginUrl: input.loginUrl,
          browserProfileName: input.profileName
        })
      });
      const targetPayload = await targetResponse.json().catch(() => null) as AccountLoginTargetsResponse | null;

      if (!targetResponse.ok || !targetPayload?.ok) {
        throw new Error(targetPayload?.error ?? "Unable to save account login target.");
      }

      setAccountTargets(targetPayload.targets);
      toast.success("Login browser opened.", {
        description: "Complete the login in the OpenClaw browser profile. AgentOS saved only the login target."
      });
      setIsConnectAccountDialogOpen(false);
      await Promise.all([loadAccountBindings(), loadAccountBrowserProfiles()]);
    } catch (error) {
      toast.error("Connect Account did not complete.", {
        description: readBrowserProfileError(error, "Unable to open the login browser.")
      });
    }
  }, [activeWorkspace, loadAccountBindings, loadAccountBrowserProfiles]);

  const openWorkspaceFiles = useCallback(
    (workspaceId: string) => {
      openWorkspaceOnCanvas(workspaceId);
      setWorkspaceFilesDialogId(workspaceId);
    },
    [openWorkspaceOnCanvas]
  );

  const handleWorkspaceFilesOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setWorkspaceFilesDialogId(null);
    }
  }, []);

  return {
    isWorkspaceWizardOpen,
    workspaceWizardInitialMode,
    workspaceWizardEditId,
    openWorkspaceWizard,
    openWorkspaceWizardForEdit,
    handleWorkspaceWizardOpenChange,
    isWorkspaceChannelsOpen,
    setIsWorkspaceChannelsOpen,
    workspaceChannelsInitialAgentId,
    setWorkspaceChannelsInitialAgentId,
    workspaceChannelsInitialSection,
    setWorkspaceChannelsInitialSection,
    openWorkspaceChannels,
    openAccountsConnect,
    isConnectAccountDialogOpen,
    setIsConnectAccountDialogOpen,
    accountBrowserProfiles,
    accountTargets,
    setAccountTargets,
    accountAccessRules,
    setAccountAccessRules,
    openConnectAccountDialog,
    connectAccount,
    workspaceFilesDialogId,
    openWorkspaceFiles,
    handleWorkspaceFilesOpenChange
  };
}

function readBrowserProfileError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

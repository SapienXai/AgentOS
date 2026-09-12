import type { AgentPolicy } from "@/lib/openclaw/types";
import type {
  WorkspaceKnowledgeSource,
  WorkspaceKnowledgeSourceKind
} from "@/lib/agentos/domains/workspace-knowledge";
import type { WorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import type { PlannerRuntimeEnsureDependencies } from "@/lib/openclaw/application/planner-runtime-service";
import type {
  ProjectIntelligencePack,
  ProjectIntelligencePackState
} from "@/lib/agentos/domains/project-intelligence";

export const WORKSPACE_BLUEPRINT_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_BLUEPRINT_POLICY_VERSION = "phase4-minimum-topology-v1" as const;
export const WORKSPACE_ARCHITECT_POLICY_VERSION = "phase6-intelligence-aware-architect-v1" as const;

export type WorkspaceBlueprintStatus = "draft" | "ready" | "blocked";
export type WorkspaceBlueprintFreshness = "fresh" | "stale" | "unknown";
export type WorkspaceArchitectMode = "automatic" | "review";
export type WorkspaceArchitectReasoningMode =
  | "openclaw-agent"
  | "model-runtime"
  | "deterministic-safe-fallback"
  | "unknown";

export type WorkspaceArchitectFailureKind =
  | "none"
  | "runtime-bootstrap"
  | "gateway"
  | "authorization"
  | "model"
  | "structured-output"
  | "timeout"
  | "cancelled"
  | "unknown";

export type WorkspaceArchitectRetryability = "terminal" | "transient" | "repairable" | "cancelled";

export type WorkspaceArchitectLifecycleCode =
  | "architect-started"
  | "architect-runtime-ready"
  | "architect-attempt-started"
  | "architect-model-started"
  | "architect-model-completed"
  | "architect-structured-output-rejected"
  | "architect-attempt-failed"
  | "architect-retry-scheduled"
  | "architect-attempt-completed"
  | "architect-fallback"
  | "architect-completed";

export type WorkspaceArchitectLifecycleEvent = {
  code: WorkspaceArchitectLifecycleCode;
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
  failureKind?: WorkspaceArchitectFailureKind;
  failureCode?: string;
  retryability?: WorkspaceArchitectRetryability;
  runtimeMode?: WorkspaceArchitectReasoningMode;
  modelId?: string | null;
  structuredOutputAccepted?: boolean;
};

export type WorkspaceArchitectTargetedEvidence = {
  id: string;
  sourceId: string;
  documentId?: string;
  title: string;
  classification: string;
  excerpt: string;
  selectionReason: string;
  evidenceRefIds: readonly string[];
  factIds: readonly string[];
  resourceIds: readonly string[];
  canonicalLocator?: string;
};

export type WorkspaceArchitectProjectContextRefs = {
  packId: string | null;
  packState: ProjectIntelligencePackState | null;
  factIds: string[];
  resourceIds: string[];
  evidenceRefIds: string[];
  conflictIds: string[];
};

export type WorkspaceArchitectIntelligenceInput = {
  pack: ProjectIntelligencePack;
  operatorIntent: {
    brief: string;
    constraints: string[];
    mode: WorkspaceArchitectMode;
    materialization: WorkspaceMaterialization;
  };
  targetedEvidence?: readonly WorkspaceArchitectTargetedEvidence[];
  contextStatus: {
    intelligenceStatus: "model" | "fallback" | "pending" | "blocked";
    packState: ProjectIntelligencePackState;
    partialContext: boolean;
    warnings: string[];
  };
};

export type WorkspaceArchitectProposalBoundary =
  | "persistent-responsibility"
  | "security"
  | "tool-access"
  | "communication-identity"
  | "independent-queue"
  | "persistent-context"
  | "explicit-operator-request";

export type WorkspaceArchitectProposalIntent =
  | "explicit-request"
  | "evidence-backed-request"
  | "descriptive-only";

export type WorkspaceArchitectProposalAgent = {
  id?: string;
  role?: string;
  name?: string;
  purpose?: string;
  responsibilities?: string[];
  outputs?: string[];
  skillIds?: string[];
  toolIds?: string[];
};

export type WorkspaceArchitectProposalSpecialist = WorkspaceArchitectProposalAgent & {
  justification: {
    reason: string;
    boundary: WorkspaceArchitectProposalBoundary;
    evidenceRefs: string[];
  };
};

export type WorkspaceArchitectProposal = {
  identity?: {
    name?: string;
    purpose?: string;
    projectType?: string;
  };
  workforce?: {
    primaryAgent?: WorkspaceArchitectProposalAgent;
    specialists?: WorkspaceArchitectProposalSpecialist[];
  };
  operations?: {
    workflows?: Array<{
      id: string;
      name?: string;
      goal?: string;
      trigger?: "manual" | "event" | "cron" | "launch";
      ownerAgentId?: string;
      collaboratorAgentIds?: string[];
      successDefinition?: string;
      outputs?: string[];
      evidenceRefs?: string[];
    }>;
    automations?: Array<{
      id: string;
      name?: string;
      description?: string;
      scheduleKind?: "every" | "cron";
      scheduleValue?: string;
      agentId?: string;
      mission?: string;
      thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
      announce?: boolean;
      intent: WorkspaceArchitectProposalIntent;
      justification: string;
      evidenceRefs: string[];
    }>;
    channels?: Array<{
      id: string;
      type: "slack" | "telegram" | "whatsapp" | "discord" | "googlechat";
      name?: string;
      purpose: string;
      target?: string;
      announce?: boolean;
      intent: WorkspaceArchitectProposalIntent;
      evidenceRefs: string[];
    }>;
  };
  capabilities?: {
    skills?: Array<{ id: string; rationale?: string; evidenceRefs?: string[] }>;
    tools?: Array<{ id: string; rationale?: string; evidenceRefs?: string[] }>;
  };
  memory?: {
    durableFacts?: Array<{
      text: string;
      evidenceRefs: string[];
    }>;
  };
  connections?: Array<{
    id: string;
    provider: string;
    intent: WorkspaceArchitectProposalIntent;
    status?: "declared" | "required" | "recommended";
    purpose?: string;
    sourceId?: string | null;
    evidenceRefs: string[];
  }>;
  recommendations?: string[];
  assumptions?: string[];
  warnings?: string[];
  confidence?: "high" | "medium" | "low";
};

export type WorkspaceBlueprintEvidenceKind =
  | "brief"
  | "knowledge-source"
  | "native-memory"
  | "corpus-document"
  | "operator";

export type WorkspaceBlueprintEvidence = {
  id: string;
  kind: WorkspaceBlueprintEvidenceKind;
  sourceId: string | null;
  summary: string;
  confidence: number;
  imported: boolean;
};

export type WorkspaceBlueprintAgent = {
  id: string;
  role: string;
  name: string;
  enabled: true;
  persistence: "primary" | "specialist";
  isPrimary: boolean;
  purpose: string;
  responsibilities: string[];
  outputs: string[];
  skillIds: string[];
  toolIds: string[];
  policy: AgentPolicy;
  justification: string;
  evidenceRefs: string[];
};

export type WorkspaceBlueprintWorkflow = {
  id: string;
  name: string;
  goal: string;
  trigger: "manual" | "event" | "cron" | "launch";
  ownerAgentId: string;
  collaboratorAgentIds: string[];
  successDefinition: string;
  outputs: string[];
  enabled: boolean;
  evidenceRefs: string[];
};

export type WorkspaceBlueprintAutomation = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: "every" | "cron";
  scheduleValue: string;
  agentId: string;
  mission: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  announce: boolean;
  selection: "explicit" | "recommended";
  evidenceRefs: string[];
};

export type WorkspaceBlueprintChannel = {
  id: string;
  type: "slack" | "telegram" | "whatsapp" | "discord" | "googlechat";
  name: string;
  purpose: string;
  target?: string;
  enabled: boolean;
  announce: boolean;
  authenticationKind: "none" | "token" | "service-account" | "qr-session" | "unknown";
  requiresCredentials: boolean;
  requiresAuthentication: boolean;
  primaryAgentId: string;
  selection: "explicit" | "recommended";
  evidenceRefs: string[];
};

export type WorkspaceBlueprintConnection = {
  id: string;
  provider: string;
  status: "declared" | "required" | "recommended";
  purpose: string;
  sourceId: string | null;
  credentials: "not-in-blueprint";
};

export type WorkspaceBlueprintOperatorOverrides = {
  lockedPaths: string[];
  lockedDecisions: string[];
};

export type WorkspaceBlueprint = {
  schemaVersion: typeof WORKSPACE_BLUEPRINT_SCHEMA_VERSION;
  status: WorkspaceBlueprintStatus;
  id: string;
  createdAt: string;
  updatedAt: string;
  identity: {
    name: string;
    purpose: string;
    projectType: string;
  };
  brief: string;
  operatorConstraints: string[];
  materialization: WorkspaceMaterialization;
  knowledge: {
    sources: WorkspaceKnowledgeSource[];
    generationId: string | null;
    sourceIds: string[];
    coverage: {
      sourceCount: number;
      readySourceCount: number;
      documentCount: number;
    };
    retrieval: {
      mode: "native-memory-search" | "bounded-corpus-assembly" | "none";
      queries: string[];
      evidenceRefs: string[];
    };
  };
  workforce: {
    primaryAgent: WorkspaceBlueprintAgent;
    specialists: WorkspaceBlueprintAgent[];
    allowEphemeralSubagents: true;
    maxParallelRuns: number;
  };
  capabilities: {
    skills: Array<{
      id: string;
      status: "selected" | "recommended";
      source: "openclaw-preset" | "operator";
      rationale: string;
      evidenceRefs: string[];
    }>;
    tools: Array<{
      id: string;
      status: "selected" | "recommended";
      rationale: string;
      evidenceRefs: string[];
    }>;
  };
  memory: {
    ownership: "openclaw-native";
    search: "native-gateway-preferred";
    seedRequired: false;
    durableFacts: string[];
    rationale: string;
  };
  connections: WorkspaceBlueprintConnection[];
  operations: {
    workflows: WorkspaceBlueprintWorkflow[];
    automations: WorkspaceBlueprintAutomation[];
    channels: WorkspaceBlueprintChannel[];
  };
  safety: {
    workspaceOnly: true;
    generationSideEffectFree: true;
    importedKnowledgeUntrusted: true;
    notes: string[];
  };
  recommendations: string[];
  assumptions: string[];
  warnings: string[];
  evidence: WorkspaceBlueprintEvidence[];
  /** Bounded traceability back to the immutable Project Intelligence claims. */
  projectContextRefs?: WorkspaceArchitectProjectContextRefs;
  operatorOverrides: WorkspaceBlueprintOperatorOverrides;
  provenance: {
    architectRunId: string;
    inputFingerprint: string;
    knowledgeGenerationId: string | null;
    sourceIds: string[];
    createdAt: string;
    modelId: string | null;
    runtime: "native-openclaw" | "bounded-local" | "unknown";
    reasoningMode: WorkspaceArchitectReasoningMode;
    failureKind: WorkspaceArchitectFailureKind;
    latestRevisionInstruction?: string | null;
    policyVersion: typeof WORKSPACE_ARCHITECT_POLICY_VERSION;
  };
};

export type WorkspaceArchitectCorpusDocument = {
  documentId?: string;
  sourceId: string;
  classification?: string;
  canonicalLocator?: string;
  title?: string;
  summary?: string;
  content?: string;
  contentLength?: number;
};

export type WorkspaceArchitectKnowledgeInput = {
  generationId?: string | null;
  sources?: WorkspaceKnowledgeSource[];
  documents?: WorkspaceArchitectCorpusDocument[];
  warnings?: string[];
  /** Phase 2 snapshot-shaped input; only bounded metadata/previews are consumed. */
  snapshot?: {
    generationId?: string | null;
    state?: { generationId?: string | null };
    documents?: WorkspaceArchitectCorpusDocument[];
  };
};

export type WorkspaceArchitectInput = {
  brief: string;
  revisionInstruction?: string;
  materialization?: WorkspaceMaterialization;
  knowledge?: WorkspaceArchitectKnowledgeInput;
  mode?: WorkspaceArchitectMode;
  operatorConstraints?: string[];
  operatorOverrides?: Partial<WorkspaceBlueprintOperatorOverrides>;
  projectIntelligence?: WorkspaceArchitectIntelligenceInput;
};

export type WorkspaceBlueprintFreshnessResult = {
  status: WorkspaceBlueprintFreshness;
  blueprintGenerationId: string | null;
  currentGenerationId: string | null;
  reason: string;
};

export type WorkspaceBlueprintValidationIssue = {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type WorkspaceBlueprintValidation = {
  valid: boolean;
  issues: WorkspaceBlueprintValidationIssue[];
};

export type WorkspaceArchitectResult = {
  blueprint: WorkspaceBlueprint;
  summary: string;
  assumptions: string[];
  warnings: string[];
  recommendations: string[];
  validation: WorkspaceBlueprintValidation;
  freshness: WorkspaceBlueprintFreshnessResult;
  reasoning: {
    status: "model" | "fallback" | "blocked";
    mode: WorkspaceArchitectReasoningMode;
    attempts: number;
      modelId: string | null;
      warning: string | null;
      failureKind: WorkspaceArchitectFailureKind;
      failureCode?: string;
      retryability?: WorkspaceArchitectRetryability;
      remoteRunId?: string | null;
      remoteSessionKey?: string | null;
  };
};

export type WorkspaceBlueprintRevisionInput = {
  brief?: string;
  revisionInstruction?: string;
  materialization?: WorkspaceMaterialization;
  operatorEdits?: {
    identity?: Partial<WorkspaceBlueprint["identity"]>;
    workforce?: {
      primaryAgent?: Partial<WorkspaceBlueprintAgent>;
      specialists?: WorkspaceBlueprintAgent[];
    };
    operations?: {
      workflows?: WorkspaceBlueprintWorkflow[];
      automations?: WorkspaceBlueprintAutomation[];
      channels?: WorkspaceBlueprintChannel[];
    };
    recommendations?: string[];
  };
  operatorConstraints?: string[];
  knowledge?: WorkspaceArchitectKnowledgeInput;
  projectIntelligence?: WorkspaceArchitectIntelligenceInput;
};

export type WorkspaceArchitectNativeSearchResult = {
  status: "available" | "unavailable" | "unknown";
  results: Array<{
    sourceId?: string | null;
    text?: string | null;
    snippet?: string | null;
    citation?: string | null;
    score?: number | null;
  }>;
  warning?: string | null;
};

export type WorkspaceArchitectRunOptions = {
  now?: () => string;
  runId?: string;
  modelId?: string | null;
  nativeSearch?: (query: string) => Promise<WorkspaceArchitectNativeSearchResult>;
  modelExecutor?: WorkspaceArchitectModelExecutor;
  architectSessionKey?: string;
  /** Trusted server-side test seam; never accept runtime dependencies from an HTTP payload. */
  runtimeDependencies?: PlannerRuntimeEnsureDependencies;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  /** Trusted server-side retrieval seam. The caller supplies selected document ids only. */
  readKnowledgeDocuments?: (documentIds: readonly string[], options?: { signal?: AbortSignal }) => Promise<WorkspaceArchitectCorpusDocument[]>;
  onLifecycleEvent?: (event: WorkspaceArchitectLifecycleEvent) => void | Promise<void>;
  /** Policy guard supplied by the creation service; does not create a second pipeline. */
  maxSpecialists?: number;
};

export type WorkspaceArchitectModelExecutionRequest = {
  systemPrompt: string;
  userPrompt: string;
  mode: WorkspaceArchitectMode;
  runId: string;
  attempt: number;
  timeoutMs: number;
  signal: AbortSignal;
};

export type WorkspaceArchitectModelExecutionResult = {
  text: string;
  runId?: string | null;
  modelId?: string | null;
  runtime?: "native-openclaw" | "model-runtime" | "unknown";
  sessionKey?: string | null;
};

export type WorkspaceArchitectModelExecutor = (
  request: WorkspaceArchitectModelExecutionRequest
) => Promise<WorkspaceArchitectModelExecutionResult>;

export type WorkspaceBlueprintSourceSummary = {
  id: string;
  kind: WorkspaceKnowledgeSourceKind;
  label: string;
  summary: string;
};

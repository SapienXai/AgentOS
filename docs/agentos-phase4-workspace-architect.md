# AgentOS Phase 4 — Workspace Architect

Phase 4 adds a canonical architecture boundary for the final user workspace. It drafts an editable `WorkspaceBlueprint`; it does not create the final workspace, provision user agents, mutate user OpenClaw configuration, restart a Gateway, connect an account, or schedule an automation. The default Architect path may ensure the hidden AgentOS internal runtime described below.

## Architect Intelligence

`generateWorkspaceBlueprint` follows this boundary:

```text
bounded evidence pack
  -> structured Workspace Architect proposal
  -> deterministic policy enforcement and normalization
  -> schema validation
  -> WorkspaceBlueprint
```

The model proposes architecture. Application code remains authoritative for safety, trust, topology, references, known capabilities, credentials, and side effects. The proposal is smaller than the final blueprint and cannot contain deployment state or credentials.

The default execution path is the existing AgentOS/OpenClaw `OpenClawAdapter.runAgentTurn` boundary. Before the first turn, `runStructuredWorkspaceArchitectAgent` calls `ensureWorkspaceArchitectRuntime`, which authoritatively discovers or repairs the hidden runtime and resolves `agentos-planner-runtime-architect`. Tests may inject a `WorkspaceArchitectModelExecutor` without introducing a provider SDK. Execution has a bounded timeout and at most three attempts, including repair attempts for invalid structured output.

If runtime bootstrap, Gateway access, model execution, timeout/cancellation, or structured output is unavailable, AgentOS returns a safe one-primary draft with `deterministic-safe-fallback` provenance, a bounded failure kind, and a visible warning. It never labels that draft as AI reasoning. Normal output is not guaranteed deterministic; input fingerprints, normalization, validation, policy enforcement, and fallback behavior are deterministic.

## Canonical boundary

`generateWorkspaceBlueprint` accepts the operator brief, explicit operator constraints, the independent physical `materialization`, declared knowledge sources, an optional Phase 2 corpus view, and trusted operator overrides. It returns an evidence-backed blueprint plus validation, assumptions, warnings, recommendations, provenance, reasoning status, and freshness.

`WorkspaceBlueprint` is the canonical architecture model for Phase 4 and Phase 5. `WorkspacePlan` remains a legacy planner envelope used by the existing wizard and deployment path. It is a compatibility projection, not a second Phase 4 source of truth. Deployment state (`runtime`, `deploy`, created IDs, provisioned IDs, and kickoff IDs) is intentionally absent from the blueprint.

## Minimum automatic topology

Automatic generation starts with exactly one enabled primary operator, no persistent specialists, no automations, no external channels, and no new connections. Persistent specialists require a distinct, meaningful responsibility or security, tool, communication, queue, or context boundary. A recurring or event-driven automation requires operator evidence. A channel requires an explicit operator request or a clearly stated communication requirement. Connections are declarations only; credentials never enter a blueprint.

Workspace size is a presentation/complexity label. It does not resize the workforce or operating topology. Existing explicit edits remain intact.

## Internal planning versus generated workforce

The hidden `AgentOS Planner Runtime` is AgentOS-owned internal infrastructure at `.mission-control/planner/runtime-workspace` with the `mission-control-planner` system tag. `ensureWorkspaceArchitectRuntime` provisions only that hidden workspace and its Architect agent for normal Phase 4 generation. The legacy planner calls the same canonical lifecycle boundary with advisors enabled when it needs its advisor board; advisors are not required for a normal Architect turn. Ensuring this runtime is an allowed internal side effect. It is never copied into a generated workspace and never appears in `WorkspaceBlueprint` or user workforce selectors. Final user workspace provisioning remains outside the Architect application service.

## Knowledge understanding and trust

OpenClaw native Gateway memory search is preferred when a trusted runtime already supplies an agent and adapter. Results are normalized into bounded evidence and placed in a focused evidence pack; the whole corpus is never dumped into the model prompt. Before a workspace/agent is bound, the architect can use only bounded Phase 2 corpus metadata/previews supplied by the caller; this is context assembly, not a custom RAG implementation.

Knowledge can materially change architecture when it establishes a real persistent responsibility or boundary, such as a continuous support queue with restricted CRM access. Descriptive facts such as “the website has a support page” or “the team usually reviews analytics every morning” remain evidence, but do not create a specialist or automation by themselves. Knowledge sources and live runtime connections remain separate concepts.

Imported knowledge is untrusted. It can establish factual evidence for names, purpose, boundaries, and warnings, but imported instructions cannot become AgentOS policy or explicit operator intent. `explicit-operator-request` specialists and explicit automation/channel/connection requests require `brief` or `operator` evidence. Evidence-backed requests may use imported facts only when they describe a genuine operating requirement; imperative prompt-injection text is not authority. A knowledge source remains distinct from a runtime connection, and credentials never enter a blueprint. Evidence is bounded, source-linked, and does not contain chain-of-thought.

## Provenance, freshness, and revision

Every run records an architect run ID, deterministic input fingerprint, source IDs, knowledge generation ID, creation time, and model/runtime provenance when available. A blueprint is `fresh` only when its knowledge generation matches the current generation; missing identity is `unknown`, and a changed generation is `stale`.

`reviseWorkspaceBlueprint` re-runs Architect reasoning when the brief, knowledge, materialization, or constraints change, then applies previous locked decisions before applying new operator edits. An empty operator choice (for example, zero specialists or zero automations) is still a decision and is not silently re-added when later knowledge changes.

## Capability and memory ownership

The primary agent reuses the existing OpenClaw/AgentOS worker preset and workspace-only policy. Custom skills are not invented by the architect. Unknown model-suggested skills/tools are excluded with a warning. OpenClaw owns memory storage, indexing, embeddings, and search. AgentOS records memory intent and native binding intent only.

Generic inferred purpose is not written to durable memory. Durable facts require explicit operator evidence and durable language such as a permanent constraint, preference, objective, decision, or approval rule. Project documentation remains searchable knowledge, not `MEMORY.md` content. Native Gateway search remains independent from any later local maintenance fallback.

## Channel authentication metadata

Blueprint channel metadata is setup intent only; it never authenticates an account. It follows the OpenClaw 2026.9.4 channel contract: Telegram, Slack, and Discord use token credentials; Google Chat uses service-account setup; WhatsApp uses Gateway-owned QR/session authentication and therefore has `requiresCredentials: false`, `requiresAuthentication: true`, and `authenticationKind: "qr-session"`. Live account status and authentication flows remain owned by OpenClaw channel services.

Regex and heuristics are guardrails only: explicit constraint extraction, sanitation, bounded fallback identity, action-intent safety checks, and deterministic validation. They are not the primary semantic architect.

## Proposal policy and enforcement

Every accepted proposal is normalized to exactly one primary agent. Persistent specialists require a meaningful justification boundary (`persistent-responsibility`, `security`, `tool-access`, `communication-identity`, `independent-queue`, `persistent-context`, or `explicit-operator-request`) plus valid evidence references. Automations require actionable recurring/event intent, a schedule, a justification, and valid evidence. Channels require actual AI communication intent; a statement about how customers communicate is not sufficient. Operator constraints always win over model and imported evidence.

## Phase 5 handoff

Phase 5 can build review/edit UX around these application APIs:

- `generateWorkspaceBlueprint(input, options?)`
- `reviseWorkspaceBlueprint(blueprint, input, options?)`
- `validateWorkspaceBlueprint(value)`
- `getWorkspaceBlueprintFreshness(blueprint, currentKnowledgeGenerationId)`
- `WorkspaceArchitectModelExecutor`

The next phase must translate an accepted blueprint into the existing workspace creation contract. It must keep provisioning outside the architect and preserve honest degraded states for unavailable OpenClaw capabilities.

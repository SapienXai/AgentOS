# AgentOS Phase 4 — Workspace Architect

Phase 4 adds a canonical, side-effect-free workspace architecture boundary. It drafts an editable `WorkspaceBlueprint`; it does not create a workspace, provision agents, mutate OpenClaw configuration, restart a Gateway, connect an account, or schedule an automation.

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

The default execution path is the existing AgentOS/OpenClaw `OpenClawAdapter.runAgentTurn` boundary, using the hidden planner-runtime Architect agent when that runtime is available. It inherits configured OpenClaw model routing and authorization. Tests may inject a `WorkspaceArchitectModelExecutor` without introducing a provider SDK. Execution has a bounded timeout and at most three attempts, including repair attempts for invalid structured output.

If the model/runtime is unavailable or all bounded attempts return invalid output, AgentOS returns a safe one-primary draft with `deterministic-safe-fallback` provenance and a visible warning. It never labels that draft as AI reasoning. Normal output is not guaranteed deterministic; input fingerprints, normalization, validation, policy enforcement, and fallback behavior are deterministic.

## Canonical boundary

`generateWorkspaceBlueprint` accepts the operator brief, explicit operator constraints, the independent physical `materialization`, declared knowledge sources, an optional Phase 2 corpus view, and trusted operator overrides. It returns an evidence-backed blueprint plus validation, assumptions, warnings, recommendations, provenance, reasoning status, and freshness.

`WorkspaceBlueprint` is the canonical architecture model for Phase 4 and Phase 5. `WorkspacePlan` remains a legacy planner envelope used by the existing wizard and deployment path. It is a compatibility projection, not a second Phase 4 source of truth. Deployment state (`runtime`, `deploy`, created IDs, provisioned IDs, and kickoff IDs) is intentionally absent from the blueprint.

## Minimum automatic topology

Automatic generation starts with exactly one enabled primary operator, no persistent specialists, no automations, no external channels, and no new connections. Persistent specialists require a distinct, meaningful responsibility or security, tool, communication, queue, or context boundary. A recurring or event-driven automation requires operator evidence. A channel requires an explicit operator request or a clearly stated communication requirement. Connections are declarations only; credentials never enter a blueprint.

Workspace size is a presentation/complexity label. It does not resize the workforce or operating topology. Existing explicit edits remain intact.

## Internal planning versus generated workforce

The legacy planner can use its hidden AgentOS planner runtime and conditional advisor board to interpret complex planning turns. Those internal agents are not copied into a generated workspace. The advisor board is used for an explicit review, a complex multi-agent/operations request, or multiple knowledge sources—not for every simple workspace.

## Knowledge understanding and trust

OpenClaw native Gateway memory search is preferred when a trusted runtime already supplies an agent and adapter. Results are normalized into bounded evidence and placed in a focused evidence pack; the whole corpus is never dumped into the model prompt. Before a workspace/agent is bound, the architect can use only bounded Phase 2 corpus metadata/previews supplied by the caller; this is context assembly, not a custom RAG implementation.

Knowledge can materially change architecture when it establishes a real persistent responsibility or boundary, such as a continuous support queue with restricted CRM access. Descriptive facts such as “the website has a support page” or “the team usually reviews analytics every morning” remain evidence, but do not create a specialist or automation by themselves. Knowledge sources and live runtime connections remain separate concepts.

Imported knowledge is untrusted. It can support evidence, names, purpose, and warnings, but imported instructions cannot change AgentOS policy or create agents, channels, automations, connections, or credentials. Current explicit operator intent has precedence over imported suggestions. Evidence is bounded, source-linked, and does not contain chain-of-thought.

## Provenance, freshness, and revision

Every run records an architect run ID, deterministic input fingerprint, source IDs, knowledge generation ID, creation time, and model/runtime provenance when available. A blueprint is `fresh` only when its knowledge generation matches the current generation; missing identity is `unknown`, and a changed generation is `stale`.

`reviseWorkspaceBlueprint` re-runs Architect reasoning when the brief, knowledge, materialization, or constraints change, then applies previous locked decisions before applying new operator edits. An empty operator choice (for example, zero specialists or zero automations) is still a decision and is not silently re-added when later knowledge changes.

## Capability and memory ownership

The primary agent reuses the existing OpenClaw/AgentOS worker preset and workspace-only policy. Custom skills are not invented by the architect. Unknown model-suggested skills/tools are excluded with a warning. OpenClaw owns memory storage, indexing, embeddings, and search. AgentOS records memory intent and native binding intent only.

Generic inferred purpose is not written to durable memory. Durable facts require explicit operator evidence and durable language such as a permanent constraint, preference, objective, decision, or approval rule. Project documentation remains searchable knowledge, not `MEMORY.md` content. Native Gateway search remains independent from any later local maintenance fallback.

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

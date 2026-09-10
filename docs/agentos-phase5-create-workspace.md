# AgentOS Phase 5 — Create Workspace

Phase 5 makes Create Workspace a brief-first review flow. The operator provides a natural-language brief, optionally adds project context, and receives a `WorkspaceBlueprint` before any final workspace provisioning occurs. Phase 5.1 stages that context through the existing Phase 2 ingestion boundary before the Architect sees it.

## Product flow

```text
brief → context → Generate Workspace → human-readable progress → Blueprint review → customize or revise
```

Automatic is the default. Customize exposes only constraints that materially change Architect input before generation. Detailed changes happen after the first blueprint through the review editor or the natural-language revision composer.

## Application boundary

Create mode uses:

- `POST /api/workspaces/architect`
- `POST /api/workspaces/architect/revise`

Both routes require the existing `workspace.manage` product permission and call the Phase 4 application services. The browser never receives planner runtime identifiers, OpenClaw sessions, Gateway lifecycle details, or credentials.

The canonical architecture truth in the client is the server-returned `WorkspaceBlueprint`. The UI only creates a local view projection for compact review sections; it does not maintain a second workspace architecture model.

## Context

Website, GitHub, Files, Folder, and Connect are context actions. Website and GitHub are submitted as knowledge sources; a GitHub repository also infers clone materialization without presenting a source as a live Connection. Files and folders are uploaded to an AgentOS-owned, actor-bound, expiring draft context. The browser sends no absolute local paths and no document previews; the server writes bounded uploads into the draft corpus and calls `ingestKnowledgeSources`, then reads a bounded `readKnowledgeSnapshot` for the Architect. Connect intentionally explains that live account setup happens later and does not request credentials during architecture review.

## Real context staging

`POST /api/workspaces/context` accepts the selected source declarations and, for files/folders, a bounded multipart upload. `stageWorkspaceCreationKnowledge` keeps the opaque `draftContextId`, source reports, generation ID, and expiry metadata under `.mission-control/workspace-create`. The draft is bound to the authenticated AgentOS actor, serialized per draft for concurrent requests, and removed after its six-hour TTL. Repeating the same successful request reuses its generation; changed or removed sources create a replacement generation. Cancellation preserves the previous successful context when one exists.

The source declaration is not ingestion evidence. Source reports distinguish attached, reading, ready, partial, error, and unsupported states. Unsupported PDF, DOC, and DOCX inputs are not advertised by the canonical file allowlist and are reported as unsupported if submitted through another client. A partial source failure does not discard successfully staged sources.

The Architect and revision routes accept only the opaque draft context reference for normal Create Workspace requests. They resolve the server-side staged context and never trust arbitrary browser-supplied corpus documents. Imported project content remains untrusted reference data: it may establish facts, but it cannot become operator policy or explicit requests.

## Revision context

Revision instructions are sent as a separate bounded `revisionInstruction`. The canonical operator brief is preserved rather than repeatedly appending revision text to it. The latest revision is included in the Architect evidence pack, represented as bounded non-imported operator evidence, and recorded in blueprint provenance. Deterministic specialist, automation, channel, and connection checks use the brief, constraints, and latest revision as operator intent, while imported evidence remains untrusted. A later revision replaces the previous revision for the next run; it is never accumulated as a transcript.

## Honest states

Generation presents only request-backed coarse stages: `Reading project context` while context staging is in flight, `Designing your workspace` while the Architect request is in flight, and `Preparing your review` after the Architect response has returned. There is no timer-driven phase advancement and no frontend brief regex presented as Architect analysis. Context chips initially say `Attached` or `Reading`; `Ready`, `Partial`, `Failed`, and the staged count are shown only from returned source reports. The post-generation `Blueprint signals` rail is a projection of the validated server-returned blueprint, not an inference from the brief.

Cancellation preserves the brief and sources. Model fallback is shown as a basic draft, not as a healthy ready state. Source and freshness warnings remain visible in review, and retry preserves the current input.

## Upload safety

`WORKSPACE_CREATION_UPLOAD_LIMITS` is the single Create Workspace upload limit source and is derived from the Phase 2 ingestion limits: 120 files, 1 MB per file, 8 MB per source, and 32 MB total. When a multipart request includes `Content-Length`, the route rejects a request beyond the bounded multipart envelope before calling `formData()`. After multipart parsing, the route validates manifest/file count and names, each `File.size`, per-source cumulative size, and total size before calling any `arrayBuffer()`. The service repeats byte limits as a defense-in-depth check for non-route callers. Client-side checks are only UX helpers; the server remains authoritative.

The Next.js multipart parser may buffer the request while `request.formData()` runs, so this is not streaming enforcement. The closure prevents the application from converting rejected `File` objects into additional `Buffer` allocations or staging them before metadata validation. Oversized files and batches return concise user-facing errors without exposing paths or implementation details.

WhatsApp is shown as `Setup required · QR sign-in`; token-based channels use token setup language. No channel, connection, automation, agent, or final workspace is activated by Phase 5.

## Phase 6 boundary

The review action for final creation is intentionally unavailable until Phase 6 owns materialization and verification. Phase 5 may generate and revise architecture only. Ensuring a temporary AgentOS-owned staging context and writing its draft corpus are allowed internal preparation side effects; creating the final user workspace, agents, channels, automations, connections, or authentication remains absent. The existing legacy Planner and workspace provisioning APIs remain compatibility infrastructure for other flows, but the new Create mode does not route through them.

# AgentOS Phase 5 — Create Workspace

Phase 5 makes Create Workspace a brief-first review flow. The operator provides a natural-language brief, optionally adds lightweight project context, and receives a `WorkspaceBlueprint` before any final workspace provisioning occurs.

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

Website, GitHub, Files, Folder, and Connect are context actions. Website and GitHub are submitted as knowledge sources; a GitHub repository also infers clone materialization without presenting a source as a live Connection. Text-like local files and folder previews are bounded before submission. Connect intentionally explains that live account setup happens later and does not request credentials during architecture review.

## Honest states

Generation presents human-readable stages without fake percentages. Cancellation preserves the brief and sources. Model fallback is shown as a basic draft, not as a healthy ready state. Source and freshness warnings remain visible in review, and retry preserves the current input.

WhatsApp is shown as `Setup required · QR sign-in`; token-based channels use token setup language. No channel, connection, automation, agent, or final workspace is activated by Phase 5.

## Phase 6 boundary

The review action for final creation is intentionally unavailable until Phase 6 owns materialization and verification. Phase 5 may generate and revise architecture only. The existing legacy Planner and workspace provisioning APIs remain compatibility infrastructure for other flows, but the new Create mode does not route through them.

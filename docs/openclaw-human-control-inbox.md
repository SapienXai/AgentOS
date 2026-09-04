# OpenClaw Human Control Inbox

Human Control is AgentOS's operator-facing projection of work that currently needs a human. It is not a second approval, question, task-suggestion, or runtime lifecycle. OpenClaw remains authoritative for each native lifecycle; AgentOS reads, normalizes, orders, explains, and routes safe actions back to the native method.

## Attention projection

The canonical `AttentionItem` projection has one stable identity per current source item:

- `approval:<exec|plugin>:<nativeId>` for native approvals
- `question:<nativeId>` for native questions
- `suggestion:<nativeId>` for OpenClaw task suggestions
- deterministic AgentOS identities for relevant setup, blocked-capability, and runtime projections

The default queue contains pending/current items only. Resolved native items disappear after authoritative reconciliation. AgentOS does not persist native pending, approved, rejected, answered, or dismissed state as a competing source of truth.

## Native sources and actions

Human Control consumes bounded native reads for `exec.approval.list`, `plugin.approval.list`, and `question.list`, and routes approval/question actions through `exec.approval.resolve`, `plugin.approval.resolve`, and `question.resolve`. Existing `taskSuggestions.list`, `taskSuggestions.accept`, and `taskSuggestions.dismiss` services are reused. Native approval/question reads and mutations are Gateway-only; they do not use CLI fallback.

Action requests are product-permission checked, preflighted against the exact OpenClaw method scope, sent once, and reconciled. If a mutation times out after it may have been sent, AgentOS re-reads the native item and returns a reconciled success only when the item is gone. It never blindly retries an ambiguous native mutation.

The source-of-truth split is explicit: approval status, question status, and suggestion status come from OpenClaw; capability status is the OpenClaw fact set projected by AgentOS; runtime status comes from the existing OpenClaw-backed runtime model; queue category, severity, ordering, grouping, and human explanation belong to AgentOS; operator actor/action audit belongs to AgentOS.

## Categories, relevance, and deduplication

The projection categories are approval, question, suggested work, needs setup, blocked, and runtime issue. Severity and ordering are deterministic: critical, high, normal, then low; within a severity, older actionable items come first and stable IDs break ties. No LLM priority scoring is used.

Effective-capability setup/blocker items are only admitted when a bounded caller supplies an operationally relevant worker/session context. Hypothetical organization-wide capability gaps are not dumped into the queue. A matching native approval or question takes precedence over a derived blocked/runtime representation so one underlying intervention does not become duplicate noise.

## Runtime and dashboard behavior

Runtime issues use the existing actionable runtime issue projection and existing task/snapshot data. Human Control is lazy on the Dashboard: the compact launcher does not load the full queue while the root snapshot is rendered. The full inbox performs parallel bulk reads and never performs one RPC per worker, capability, approval, or revision.

The existing Gateway event bridge remains the only subscription/reconnect owner. Approval, question, suggestion, session, tool, and runtime events invalidate the relevant AgentOS read/snapshot caches. Reconnect or sequence-gap reconciliation re-reads the current native inventories rather than resurrecting local items.

## Security and trust

Approval details, question content, suggestion text, runtime messages, and skill content are untrusted data. They are never interpreted as AgentOS instructions. Central redaction is applied at API boundaries and sensitive command/detail text is truncated for the primary queue. Credentials, tokens, cookies, and provider secrets are not part of the projection or audit payload. AgentOS records human action provenance in its existing audit system; OpenClaw remains authoritative for native resolution.

## Certification boundary

Exact OpenClaw `2026.9.1` certification uses an isolated disposable runtime and official Gateway methods only. A fixture may seed disposable native state through an official contract for certification, but fixture-only methods are not marked product-integrated. If identity, profile ownership, or runtime prerequisites prevent safe creation of an approval/question fixture, the evidence records `SKIPPED` or `EXPECTED-DENIAL` with the exact reason instead of fabricating a successful proof.

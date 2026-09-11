# Workspace Intelligence Architecture

This document defines the Phase 1 Project Intelligence foundation, the Phase
2 creation-runtime boundary, the Phase 3 deterministic discovery boundary,
and the Phase 5 bounded intelligence-synthesis sidecar plus Phase 6
intelligence-aware Architect projection. It is a normalized,
versioned AgentOS domain contract for evidence collection, synthesis, and
workspace-architecture work. Phase 2 adds reliable observation around the
existing context and Architect path; Phase 3 adds bounded website discovery;
Phase 3.1 hardens its resource, policy, and locator boundaries; Phase 5 adds
evidence-grounded interpretation; Phase 6 feeds validated intelligence into
the existing Workspace Architect through bounded context; Phase 7 adds a
bounded content-proposal and workspace-document composition sidecar.
None of these phases implements a future verification engine, Workspace
Architect 2.0, or a parallel OpenClaw runtime.

## Ownership and boundaries

The long-term flow is:

```text
OpenClaw workspace/source conventions
        ↓
existing AgentOS ingestion and source abstractions
        ↓
deterministic Project Discovery Engine (Phase 3)
        ↓
deterministic structured extraction (Phase 4)
        ↓
normalized Project Intelligence candidate
        ↓
strict Project Intelligence validation
        ↓
ProjectIntelligencePack (Phase 5 sidecar; Phase 6 validated Architect input)
        ↓
Workspace Architect
        ↓
WorkspaceBlueprint (existing architecture contract)
        ↓
bounded Workspace Composition plan and review
        ↓
OpenClaw-native workspace materialization
```

Raw HTML, JSON-LD, connected-source payloads, ingestion metadata, and other
imported source material are untrusted input. They are not required to match
the normalized Project Intelligence object shape. Phase 1 does not add a new
raw-source abstraction; future extraction can reuse the existing
`WorkspaceKnowledgeSource` and ingestion contracts where appropriate.

Project Intelligence is an AgentOS knowledge sidecar/projection. It is not a
credential store, crawler, verifier service, task engine, memory engine, or
replacement for OpenClaw runtime state.

## Canonical authority

The domain uses one direction of authority:

- `ProjectFact` is the canonical factual CLAIM layer and owns the claim.
- `EvidenceRef` owns bounded proof and deterministic verification
  qualification.
- Verification represents epistemic qualification of a claim or resource.
- Scalar and collection projections are validated views over canonical claims.
- `ProjectConflict` is canonical conflict representation and is orthogonal to
  verification and pack readiness.
- `OfficialResource` owns resource interpretation and discovery/origin
  metadata, but has no independent trust source.

`ProjectValue<T>` is intentionally split into `ProjectScalarValue<T>` and
`ProjectCollectionValue<T>`:

- Scalar projections require every referenced fact to agree with the
  normalized projected scalar.
- Collection projections use normalized membership/set semantics for support
  and consistency. A fact may contribute distinct members. Presentation and
  ranking order is retained, stable first-seen deduplication is allowed during
  normalization, and validation never alphabetically sorts or mutates the
  collection.
- Neither projection may introduce a value not supported by its referenced
  canonical facts.

## Evidence and verification

Evidence has three distinct properties:

1. An `EvidenceRef` exists in the pack.
2. A claim/resource links to it with a `supports` relationship.
3. The evidence has a deterministic qualification capability.

The qualification capability is not hard-coded to first-party origin. The
Phase 1 contract supports authoritative first-party evidence, explicitly
qualified official uploaded documents, and authoritative connected sources.
Operator-only declarations, unknown external sources, discovered external
references, inferred claims, unsupported evidence, and merely existing
evidence cannot qualify an external claim as verified.

Phase 1 validates this boundary but does not implement the future verifier.

For an `OfficialResource`, `verification` is an interpretation validated from
its evidence relationships. Its `origin` field only describes how the
resource was discovered. A resource-level trust field is deliberately not
part of the contract.

## Conflicts and readiness

`ProjectConflict` records competing fact/resource subjects, their evidence,
confidence, and resolution status. Conflict is not a verification state. A
verified claim can participate in an open conflict with another claim.

Pack readiness is limited to:

- `empty`: no meaningful intelligence content exists;
- `partial`: some intelligence or unknowns exist, but the pack is incomplete;
- `ready`: the normalized pack is usable for a downstream consumer.

Conflict counts and open-conflict state are derived from `conflicts` with
`getProjectConflictSummary`; `conflicted` is not a mutually exclusive pack
state.

## Discovery contracts

`DiscoveryRun.state` describes lifecycle:

`pending | running | ready | partial | failed | cancelled`

`DiscoveryRun.phase` describes execution phase:

`discovery | fetch | extraction | synthesis | finalization | null`

`DiscoveryEvent.phase` uses only the execution-phase type. Event payloads are
structured and transport-independent. Phase 1 adds no SSE, polling,
WebSocket, crawler, or durable execution implementation.

## Normalization and validation

Normalization functions are the mutation-free input preparation boundary in
the sense that they return new normalized values: they canonicalize bounded
text, redact secrets through the existing AgentOS redaction utility, dedupe
IDs, and preserve intentional collection order.

Validation functions are deterministic and non-mutating. They validate only
normalized Project Intelligence domain objects, reject unsupported fields at
those boundaries, enforce references and projection consistency, and prevent
credential-like fields from bypassing the typed contract.

Public identifiers remain representable when they are public and evidence-
backed, including blockchain contract addresses, network identifiers,
package IDs, application IDs, repository identifiers, and public API URLs.

## Golden standard

The test fixtures are deterministic and have no live internet dependency:

- `CoinCollect` exercises a Web3-shaped project, public contract identifiers,
  official resources, and a stale conflicting external claim.
- `OrbitDesk` exercises a generic SaaS product without blockchain fields.
- `RiverKit` exercises documentation-heavy open-source software with website,
  API documentation, and repository evidence.

These fixtures are evaluation inputs for the future Project Intelligence
Agent. They do not hard-code Web3 assumptions into the domain and do not
implement production discovery or synthesis logic.

Phase 3 uses separate deterministic website fixtures for CoinCollect, a
generic SaaS site, and documentation-heavy software. They exercise root and
subdomain traversal, metadata/navigation/footer harvesting, sitemaps,
external candidate preservation, contact discovery, canonicalization, and
bounded security behavior without live network access.

## Existing Create Workspace flow

Phase 1 and Phase 4 do not change the existing Create Workspace runtime. Its current
flow remains:

```text
Create Workspace → context staging → ingestion → bounded corpus → Workspace Architect → WorkspaceBlueprint → review → provisioning → OpenClaw workspace → knowledge promotion
```

Project Intelligence is an additive normalized sidecar. It does not replace
WorkspaceBlueprint, alter provisioning, or claim ownership of OpenClaw
workspace materialization.

## Phase 3 Project Discovery Engine

Project Discovery is a deterministic evidence-collection boundary between
declared sources and the existing knowledge corpus. It does not synthesize a
`ProjectIntelligencePack`, decide truth, verify official ownership, or use an
LLM. Its output is a bounded `ProjectDiscoveryManifest` containing observed
pages, candidates, contacts, metadata, relationships, fetch status, and
warnings. These are discovered candidates, not verified official resources.

Website traversal uses a public-suffix-aware registrable-domain check. The
root host and explicitly policy-approved subdomains such as `docs`,
`developers`, `api`, `help`, and `support` may be crawled within the same
source limits. `app`, `www`, and `blog` are shallow, useful candidates;
infrastructure-like subdomains such as `cdn`, `static`, `assets`, `status`,
and `tracking` are recorded but not recursively crawled by default. A naïve
hostname suffix match is not used, so lookalikes such as
`project.org.attacker.example` remain outside the site family.

Every fetch remains behind the existing AgentOS HTTP, DNS, public-address,
redirect, byte, page, depth, concurrency, and total-run bounds. Redirects and
new hostnames are revalidated. External links such as repositories, social
profiles, explorers, support platforms, and document hosts are retained with
their source-page provenance but are never recursively crawled. Mail and
telephone links are normalized as contact candidates and are never fetched.

Robots policy and a bounded set of sitemap/index locations are inspected
before page scheduling. Malformed robots and sitemap material is ignored as a
bounded discovery miss. Navigation, footer, canonical, alternate/meta,
OpenGraph, Twitter, title, JSON-LD type, contact, document, and application
signals are harvested before navigation/footer/body cleanup. JSON-LD is
bounded, parsed without execution, and remains untrusted observation data.

The scheduler uses deterministic priority signals so root, documentation,
developer, product, support, contact, security, integration, and similar
project surfaces are favored over boilerplate, archives, and pagination. URL
normalization removes fragments, default ports, and common tracking or
credential-like parameters while preserving benign query parameters. Safe
display locators remove query strings and fragments before entering
`WorkspaceCreationRun` events or snapshots; durable locators preserve safe
identity-bearing query parameters for manifests and evidence.

The static fetch path is the default. Low-information JavaScript shell pages
are detected with bounded deterministic signals. No new browser runtime is
created: because the current server-side discovery boundary has no approved
rendered-fetch capability, the manifest records an explicit unavailable
fallback warning and continues with whatever static evidence is usable.

Discovered pages are projected into the existing protected knowledge corpus;
the bounded manifest is stored alongside the knowledge generation state for
future extraction without rescanning raw HTML. Phase 3 does not create a
second memory system, raw-source abstraction, verifier, fact extractor, or
Project Intelligence Agent. Phase 4 may consume these manifests to perform
structured extraction and official-source verification.

## Phase 3.1 discovery hardening

The discovery engine uses one `ProjectDiscoverySourceByteBudget` per source.
Robots, sitemap/index, redirect, and page responses reserve capacity before
fetching, receive that reservation as their maximum body size, and settle the
reservation with actual bytes. Unused capacity is released; failed requests
are accounted for conservatively. The invariant
`committed + reserved <= capacity` is maintained even while page batches run
concurrently, so document-level limits cannot multiply into an unbounded
source total.

All URL-derived discovery paths use the same typed crawl policy:
`crawl`, `shallow`, `record-only`, or `blocked`. Root and `www` hosts are
normal, documentation/developer/API/help/support subdomains are high-value,
`app` and `blog` are shallow, and infrastructure subdomains are recorded
without crawling. Sitemap and robots declarations, canonical links, anchors,
and JSON-LD links cannot bypass this policy.

JSON-LD is treated as untrusted observation material. It is parsed without
execution under bounded script, object, depth, array, and string limits.
Names, URLs, contact observations, application categories, operating systems,
and repository/documentation candidates retain page provenance; malformed or
instruction-shaped content is ignored. New manifests use schema version 2;
the validator remains read-compatible with version 1 manifests, whose absent
JSON-LD observation fields are treated as empty by consumers.

## Phase 4 deterministic structured extraction

Phase 4 consumes the bounded normalized knowledge corpus and the
`ProjectDiscoveryManifest` already staged by Phase 3. It does not introduce a
raw-source domain abstraction: raw HTML, JSON-LD, connected-source payloads,
and ingestion metadata remain untrusted material upstream of the existing
ingestion boundary.

The extractor writes one deterministic, versioned
`intelligence-extraction.json` artifact inside the protected workspace-
creation context. Its input fingerprint and knowledge generation identify the
artifact for safe reuse. Document, evidence, fact, resource, conflict,
warning, unknown, and coverage limits are explicit and bounded. Normalization
canonicalizes and redacts before validation; validation is strict,
deterministic, non-mutating, and applied only to the normalized extraction
contract.

Extraction is evidence-first. `EvidenceRef` owns bounded proof and the
qualification capability. A fact or resource is marked `verified` only when
its claim relationship is `supports` and the referenced evidence has a
matching deterministic qualification capability and claim-scoped observation
matching the canonical claim. First-party website,
documentation, and repository evidence qualify by default. The contract also
accepts explicitly qualified authoritative uploaded documents and connected
sources without hard-coding provenance origin as the future verifier. Merely
existing evidence, operator declarations, inferred claims, unknown external
sources, and discovered external references remain unqualified.

`ProjectFact` remains the canonical factual claim layer. `OfficialResource`
contains only resource interpretation plus discovery/origin metadata; it has
no independent trust source. `ProjectConflict` records competing claims
orthogonally, so verified claims and verified resource interpretations may
participate in open conflicts. No inferred claims or future verification
engine is implemented.

The extraction summary is carried through the `WorkspaceCreationRun`
snapshot and structured activity events. The current run snapshot remains
authoritative even when the bounded event tail is truncated. The review
presenter exposes bounded counts and honest partial-coverage status. Phase 4
does not feed Project Intelligence into Workspace Architect, change
`WorkspaceBlueprint`, alter provisioning, or implement the Project
Intelligence Agent runtime.

## Phase 4.1 claim-scoped evidence and lock certification

Phase 4.1 makes every verified interpretation traceable to a bounded evidence
window for the exact claim or resource locator it supports. Evidence may
support multiple observations, but a generic document or page reference cannot
promote an unrelated claim. Conflicts retain the evidence references attached
to the competing canonical claims.

The knowledge corpus uses atomic durable file publication and an ownership-
checked writer lease. Reader recovery treats a journal that is being replaced
or removed by a live writer as transient state, while malformed durable control
state still fails closed. Concurrent-reader validation is isolated per test
workspace so cleanup cannot remove another active test's corpus.

## Phase 5 Project Intelligence synthesis

Phase 5 consumes only the bounded normalized extraction already staged inside
the protected workspace-creation context. The input bundle contains the
redacted operator brief as intent context, canonical facts, discovered
resources, claim-scoped evidence, conflicts, and unknowns. The brief is never
treated as proof.

The Project Intelligence Agent returns a strict, versioned
`ProjectIntelligenceSynthesisProposal`. The proposal may add only inferred
claims that reference existing evidence. It cannot add or rewrite canonical
facts, official resources, public identifiers, contacts, URLs, or other
locator-bearing values. Materialization copies canonical facts/resources and
evidence unchanged, adds only `inferred` claims, rebuilds projections from
the canonical claim layer, and preserves conflicts and unknowns.

Synthesis is persisted as `project-intelligence.json` beside the existing
protected extraction artifact. Its input fingerprint is derived from the
bounded brief and extraction identity, so an unchanged input can reuse the
pack and an invalidated input removes the old pack before regeneration. A
model failure produces an honest partial fallback pack containing preserved
canonical evidence, not invented intelligence.

The synthesis execution record is independent from the Architect execution
record. AgentOS uses the existing structured OpenClaw adapter path with an
independent Project Intelligence session namespace and idempotency identity;
it does not create a worker, provider, model, session, or cancellation
runtime. If the adapter cannot prove an interrupted turn's outcome, recovery
fails closed with an ambiguous-execution diagnostic rather than replaying a
possibly completed turn.

Project Intelligence is an additive normalized sidecar. Phase 5 does not
consume it downstream; Phase 6 passes a validated pack and bounded targeted
evidence to Workspace Architect without changing the pack or making it part of
the final Blueprint. No retrieval, embeddings, composer, project-aware
document generation, or later-phase runtime is introduced by Phase 5 itself.

## Phase 6 intelligence-aware Workspace Architect

Phase 6 consumes a validated `ProjectIntelligencePack` as bounded project
context while keeping the operator brief, constraints, mode, and
materialization as a separate operator-intent input. Architect selection uses
deterministic evidence-bearing, architecture-classified, operator-matching,
root-surface, and diversity signals over the staged corpus. It does not use a
first-N shortcut, network retrieval, crawling, embeddings, or a vector store.

Only bounded targeted excerpts enter the Architect evidence pack. The full
immutable Project Intelligence pack remains the canonical claim layer; the
Architect produces an interpretation and records only bounded
`projectContextRefs` in the existing `WorkspaceBlueprint`. Those references
may identify contributing fact, resource, evidence, and conflict records but
do not copy the pack into the Blueprint or create a second source of truth.

Architect validation rejects unknown canonical references, unsupported fields,
secret material, and specialist proposals without a distinct evidence-backed
boundary. Social or other public resources do not create channels by
themselves; public integrations do not prove credentials, active connections,
or provisioning. Open conflicts remain visible and are not silently resolved.
The default workforce remains one primary agent, with persistent specialists
requiring a distinct rationale.

Fallback and partial-context semantics remain explicit. A deterministic safe
fallback is a draft and carries bounded failure metadata. If usable but
incomplete context is supplied, the Blueprint warning says the architecture
was generated from partial project context; this is structured runtime state,
not UI text inferred from missing fields.

## Phase 2 creation execution

`WorkspaceCreationRun` is an AgentOS orchestration sidecar for the
pre-provisioning path only. Its lifecycle is:

`pending | running | review-ready | failed | cancelled`

Its execution stages cover intake, context staging, source ingestion,
Architect runtime preparation/reasoning/validation, and review preparation.
There is deliberately no provisioning stage. A creation run may record a
`provisioningHandoffReady` flag and `provisioningRunId`, but
`WorkspaceProvisioningRun` remains the only authoritative provisioning
lifecycle.

Creation runs are durable JSON records with an actor-scoped idempotency key,
protected `draftContextId`, bounded attempt diagnostics, a current snapshot,
and versioned structured events. Events are retained to a maximum of 256 per
run; the snapshot remains authoritative when older events are truncated.
Events contain stable codes and structured fields rather than UI sentences.

The transport is durable polling. Initial multipart intake returns `202` only
after upload bytes and intake metadata have been persisted through the
existing protected workspace-creation context storage. The background
executor reopens those files by actor and draft context; it never depends on
request/FormData memory. Existing context and provisioning routes remain
compatible.

One configurable overall analysis deadline governs context staging and
Architect execution. Context staging is bounded by both the existing
ingestion limit and the budget required to preserve an Architect reserve.
Architect attempts consume the remaining shared deadline, so independent
timeout stacks cannot extend the run beyond its overall budget.

Failure diagnostics separate category, stable failure code, and retryability.
Authorization, invalid configuration/request, unsupported capability, and
ambiguous remote execution are terminal. Temporary transport/provider
failures are transient; structured-output failures are repairable; explicit
cancellation is cancelled. Diagnostics are redacted and bounded.

When usable evidence survives incomplete context staging, the run records
`context.status = partial` and `architect.partialContext = true`. Architect
may continue, but the review presenter must expose that the architecture was
generated from partial project context. Partial coverage is never silently
treated as full readiness.

Creation recovery is activated by `ensureCreationRunExecution(runId)` during
initial creation, actor-authorized active polling, and reload recovery. It
uses an atomic lease and the stable `${creationRunId}:${attempt}` Architect
idempotency identity. The OpenClaw adapter contract is the authority for
whether interrupted remote execution can be replayed safely; ambiguous
outcomes fail closed rather than creating a duplicate turn.

## Phase 7 Workspace Composition planning

Phase 7 adds a bounded composition sidecar after Workspace Architect review
preparation. The Composer consumes only the validated `WorkspaceBlueprint`,
the validated Project Intelligence pack, explicit operator intent, and a
bounded inventory of allowlisted existing workspace documents. It returns
content-only proposals. Paths, filesystem operations, merge strategy,
ownership, permissions, runtime configuration, credentials, tools, skills,
channels, connections, and provisioning instructions are AgentOS policy
outputs, never model-authorized outputs.

The normalized `WorkspaceCompositionPlan` is versioned and policy-bound. Its
artifact IDs and paths are allowlisted to the established OpenClaw document
roles (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and `MEMORY.md`) plus
AgentOS project sidecars under `docs/`. Existing operator content is preserved;
only one valid managed section may be created or replaced. Existing file
hashes, materialized hashes, atomic writes, and conflict results make replay
idempotent and prevent stale review plans from overwriting operator edits.
Symlink traversal is rejected at the normalized workspace-document boundary.

Composition plans are persisted in the existing protected workspace-creation
context when a draft context exists. Provisioning receives the immutable plan
snapshot and applies it in its own `WorkspaceProvisioningRun` step after
OpenClaw has materialized the workspace. Creation and provisioning remain
separate lifecycles; composition is not a second provisioning engine.

The native OpenClaw boundary is used only for the hidden content-proposal
turn, with a dedicated session namespace and idempotency key. If an
interrupted turn has an ambiguous remote outcome, AgentOS does not replay it
and falls back to deterministic safe content. Model failure, fallback source,
attempts, conflicts, and applied counts are retained as structured run
metadata and surfaced honestly in review. No generic daemon, retrieval
system, or Composer 2.0 is introduced.

## Intelligence roles and future boundaries

The future system separates responsibilities at explicit boundaries:

- The Project Intelligence Agent now synthesizes evidence-grounded inferred
  claims from the bounded Phase 4 extraction sidecar. Broader discovery,
  verification, refresh, and review workflows remain future work.
- Workspace Architect consumes a validated Project Intelligence pack in Phase
  6 and produces the existing WorkspaceBlueprint contract with bounded
  traceability references. It does not own or mutate the pack.
- AI Workspace Composer is a bounded content-proposal sidecar with an
  independent durable composition execution record; broader retrieval,
  refresh, and document governance remain future work.

OpenClaw remains the runtime, orchestration, agent, tool, model, session, and
gateway owner. AgentOS provides the operator-facing control and normalized
domain layer above it.

## OpenClaw workspace document semantics

Workspace composition preserves the established OpenClaw document roles rather
than inventing parallel runtime concepts:

- `AGENTS.md` describes workspace operating instructions and constraints.
- `SOUL.md` describes the agent's durable character and interaction posture.
- `IDENTITY.md` describes the agent identity presented to operators and users.
- `USER.md` records relevant user context and preferences.
- `MEMORY.md` contains durable promoted memory according to the applicable
  OpenClaw memory rules.

Phase 7 may create or update bounded managed sections in these documents
through the composition plan. OpenClaw remains the owner of their runtime
meaning, agent loading, and native memory behavior; AgentOS owns only the
reviewable content proposal and safe materialization boundary.

## Phase boundaries

Phase 1 and Phase 1.1 establish normalized claims, evidence qualification
semantics, projections, conflicts, source-coverage invariants, lifecycle
contracts, fixtures, and validation. Phase 3 establishes deterministic
bounded project discovery and its corpus/creation-progress projection. Phase
4 and Phase 4.1 establish deterministic structured extraction, claim-scoped
evidence, lock recovery certification, and evidence-qualified resource
interpretation. Phase 5 adds the bounded Project Intelligence Agent synthesis
sidecar. Phase 6 makes the existing Workspace Architect consume validated
intelligence through bounded inputs without changing `WorkspaceBlueprint`
ownership.
Phase 7 adds the bounded Workspace Composition plan and its provisioning
handoff without changing `WorkspaceBlueprint` ownership. Phase 7.1 certifies
composition idempotency, crash recovery, canonical plan binding, shared
analysis budgeting, and fail-closed cancellation. Phase 8 presents the same
server-owned run and review state through a goal-first Create Workspace
experience; it does not change the underlying blueprint or provisioning
ownership.
The following remain future work:

- broader Project Intelligence discovery, verification, refresh, and review
  workflows;
- later phases: verification runtime, broader retrieval, refresh,
  transport/event streaming, and Phase 9 work;
- all phases: no duplicate OpenClaw runtime, model, tool, session, gateway, or
  workspace ownership inside AgentOS.

Source identifiers are intentionally opaque in this foundation. Phase 1 checks
their internal consistency across facts, evidence, resources, coverage, and
pack provenance, but does not resolve them against `WorkspaceKnowledgeSource`
until the future ingestion integration defines that boundary.

## Phase 7.1 durable execution and Phase 8 presentation

`WorkspaceCreationRun` owns the intelligence-to-review envelope. Its
`compositionExecution` record is independent from Architect and Project
Intelligence remote execution: the idempotency key is persisted before the
Composer turn, known remote identity is persisted after the turn, and the
execution is marked complete only after the canonical composition plan is
durable. A crash with no durable plan is ambiguous and is recovered with
deterministic safe content without replaying the remote turn. Cancellation
aborts the native OpenClaw turn and remains terminal; it cannot reopen review.

The overall analysis deadline is shared by context staging, Project
Intelligence, Architect, and Composer. Context is bounded by both ingestion
limits and reserved time for the later stages. Each model stage divides its
available budget across its bounded attempts, so independent timeout stacks
cannot exceed the single deadline.

Provisioning accepts a composition reference only after actor-scoped canonical
plan lookup. The plan is bound to the exact `WorkspaceBlueprint` fingerprint,
materialization mode, Project Intelligence pack/generation when present, and
its semantic input fingerprint. Inline plan data is accepted only as a
backward-compatible exact copy of the canonical server plan; inline-only
composition is rejected. Composition conflicts are preserved and cause the
composition provisioning step to remain incomplete while later provisioning
steps may continue, resulting in a truthful partial provisioning state.

The Phase 8 presenter maps structured run stages to operator language:
Reading project, Understanding project, Designing workspace, Preparing
workspace, and Almost ready. Review is organized around Project, AI
Workforce, Workspace, and Needs attention. It shows fallback and partial
context as explicit structured states, keeps internal diagnostics behind
progressive disclosure, and leaves provisioning labels to the existing
OpenClaw-backed provisioning run.

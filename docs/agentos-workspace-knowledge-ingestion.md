# AgentOS Workspace Knowledge Ingestion

## Decision

Knowledge declarations and knowledge ingestion are separate AgentOS concerns. A
`WorkspaceKnowledgeSource` describes where context may come from; the ingestion
engine materializes normalized, operator-auditable documents under the workspace
knowledge corpus. OpenClaw remains the owner of runtime workspaces, bootstrap
context, agents, sessions, tools, and lifecycle. AgentOS does not add a parallel
memory, search, embedding, vector, RAG, or context-injection runtime.

The Phase 1 physical workspace declaration is independent from
`knowledge.sources`:

- `workspace.materialization` is the physical starting point (`empty`, `clone`,
  or `existing`).
- `knowledge.sources` declares prompt, website, repository, file, folder, or
  connector context.

Repository knowledge may therefore be ingested while materialization is empty,
and changing one declaration never clears the other.

## Ownership and entry points

The ingestion engine is AgentOS-owned because it produces a deterministic local
corpus and metadata projection. It lives in
`lib/agentos/domains/workspace-knowledge-ingestion.ts`, with the workspace
application boundary in
`lib/agentos/application/workspace-knowledge-service.ts`.

The application entry points are:

- `ingestWorkspaceKnowledge(workspacePath, options)` — reads the canonical
  `.openclaw/project.json` declaration and runs ingestion.
- `getWorkspaceKnowledgeIngestionState(workspacePath)` — reads persisted state
  without starting work.
- `ingestKnowledgeSources(input)` — lower-level domain entry point for tests,
  staging, and callers that already have normalized declarations.

The engine returns normalized document metadata and in-memory content during a
run. Persisted state contains metadata, provenance, hashes, warnings, and source
reports; it does not contain imported document content.

## Storage layout

For a workspace at `<workspace>`:

```text
<workspace>/
  knowledge/
    sources/
      <source-id>/
        ... deterministic markdown documents ...
  .openclaw/
    project.json
    knowledge/
      writer-lock.json                 # transient destination writer lease
      state.json
      documents.json
      current.json
      generations/
        knowledge-generation-<id>/
          state.json
          documents.json
          generation.json
```

The stable, agent-readable corpus remains at `knowledge/sources/**`. A run first
builds a complete replacement at
`knowledge/.agentos-staging/<run-id>/sources/`. The active corpus directory is
swapped with a backup, then `current.json` is atomically activated to point at
the immutable generation containing the matching `state.json` and
`documents.json`. The root `state.json` and `documents.json` files are
compatibility mirrors; readers treat the generation selected by `current.json`
as authoritative and never combine independent mirrors.

`current.json` and the generation marker are the authoritative activation
boundary. The root metadata files are compatibility mirrors only; supported
readers do not combine those mirrors or read the raw corpus outside the reader
boundary.

The staging directory and old generations are removed after successful
activation. A caller can use another corpus and state root for a newly created
workspace, then promote only the managed, state-listed files with
`promoteKnowledgeCorpus`, which uses the same generation activation protocol.

## Lifecycle and progress

The observable source lifecycle is:

`pending` → `discovering` → `fetching` → `normalizing` → `staging` →
`committing` → `ready` / `partial` / `error` / `cancelled`.

Progress callbacks report the run, source, phase, status, completed and total
work, and warning count. Work is bounded by page, file, byte, sitemap, depth,
concurrency, request timeout, and total-run timeout limits. An `AbortSignal`
stops new work and preserves the last committed corpus.

## Supported source types

| Source | Phase 2 behavior |
| --- | --- |
| Prompt | Deterministic markdown document; high-confidence secrets are redacted or the source is skipped. |
| Website | Bounded same-host crawl with robots/sitemap/link discovery, no JavaScript execution, and SSRF checks. |
| Repository | Local scan or bounded shallow remote clone; no hooks, scripts, installs, or submodules. |
| File | Reads supported text formats through the safe file boundary. |
| Folder | Recursively scans supported files while ignoring noise, sensitive files, and symlinks. |
| Connector | Declaration-only report with an explicit unsupported/error state; no connector authentication. |

Supported text formats are Markdown, plain text, JSON, YAML/YML, TOML, HTML,
XML, CSV, and common README/Makefile names. PDF and DOCX are detected and
reported as unsupported in this runtime rather than silently treated as binary
text.

## Website safety

Website ingestion accepts only HTTP(S) URLs without credentials. Each hostname
is resolved immediately before each request, and all resolved addresses must be
public. Loopback, private, link-local, multicast, documentation, unspecified,
IPv4-mapped private, and other non-public targets are rejected. Redirects are
revalidated, remain on the declared host, and are bounded.

The crawler reads `robots.txt`, follows same-host sitemap declarations and
same-host links, respects a maximum depth/page count, accepts HTML/XHTML only,
strips scripts and navigation chrome, and does not run JavaScript. Failed pages
become warnings on that source; they do not erase other sources.

## Repository and local file safety

Remote repository ingestion accepts only unauthenticated HTTPS URLs on the
default HTTPS port. SSH, `git://`, `file://`, `ext::`, embedded credentials,
query parameters, and other protocols are rejected before checkout. The host
is resolved immediately before Git runs; every answer must be public, including
IPv4-mapped IPv6 answers. Git 2.37 or newer is required because the clone uses
`http.curloptResolve` to pin the resolved public address set while preserving
the hostname for TLS and the HTTP Host header. HTTP redirects are disabled, so
the clone cannot silently leave the validated host. This follows Git's
documented `HOST:PORT:ADDRESS[,ADDRESS]` resolve configuration format.

Remote repositories are cloned into a temporary directory with a shallow,
no-tags, no-submodules command. System/global Git configuration, credential
helpers, prompts, SSH variables, and proxy variables are isolated or disabled;
hooks are bypassed, and no project code is executed. The child Git process
receives the run `AbortSignal`, so cancellation terminates the checkout and
temporary checkout cleanup runs in `finally`. Local and checked-out content is
read only after realpath/symlink checks. Noise directories such as `.git`,
`node_modules`, build outputs, caches, and coverage are ignored.

The file boundary uses an explicit extension/name allowlist, per-document and
per-source byte limits, UTF-8/binary checks, and sensitive-name exclusions.
Files outside the declared root or reached through symlinks are not imported.

## Secret protection and prompt injection

High-confidence secrets are not allowed into the corpus, metadata, or logs.
Private-key blocks and sensitive files are skipped. Authorization bearer values
and assignment-style API/token/password/secret values are redacted while
placeholder/example values remain useful. Error messages use fixed summaries and
never include source contents or credentials.

Imported text is untrusted reference material. It is normalized as data and is
not interpreted as AgentOS instructions, planner patches, tool calls, OpenClaw
configuration, or authorization. Phase 2 does not inject the corpus into agent
context or execute imported commands.

## Idempotency and transactional refresh

Document IDs, output paths, canonical locators, and SHA-256 content hashes are
deterministic. Locator and content deduplication merges provenance without
duplicating files. Re-ingesting unchanged content reports unchanged items.

Each successful run stages the entire next corpus while retaining operator-owned
files and modified managed files. Partial/error sources retain their previous
files and metadata; stale managed files are pruned only for successful sources.
Existing files that are not represented by prior managed metadata are never
overwritten.

The active generation is a pair of immutable metadata files plus the matching
stable corpus directory. Metadata is written completely inside a generation
directory before activation. A durable transaction journal records the
prepared, activating, corpus-activated, and metadata-activated phases. It also
binds the transaction ID and generation ID to the writer lock ID, owner PID,
hostname, and process-start identity. On startup, on read, and after an
in-process failure, the journal either completes the new generation or restores
the previous one. Readers ignore incomplete generations, mismatched metadata,
and invalid pointers. Durable temporary-file writes and renames are used for
the journal, pointer, generation metadata, and compatibility mirrors.

Schema V1 root state and document files remain readable. The next successful
write creates a V2 generation and activates it; no destructive migration is
required before that write.

## Writer concurrency and lock ownership

Every ingestion run takes the single destination lease at
`.openclaw/knowledge/writer-lock.json`; promotion takes the lease in the target
state root. Acquisition is an atomic `open(..., "wx")` create with a durable
record containing a random `lockId`, PID, hostname, start time, heartbeat, and
process-start identity. A heartbeat is refreshed while the operation runs.

There is no second lock in the corpus path, so promotion and ingestion have one
lock ordering and cannot deadlock over the same destination. A live contender
gets the typed busy result and may retry. Every successful acquisition releases
in `finally`, including cancellation, source errors, activation failures, and
promotion failures. Release verifies the same `lockId` before removing the
lease and never removes a replacement owner's lock.

## Reader snapshots and stale-writer recovery

`readKnowledgeIngestionState` and the exported `readKnowledgeSnapshot` are the
supported reader boundaries. A reader never recovers a transaction while a
writer lease is live. During staging, or while a journal is still `prepared`,
the reader returns the last pointer-selected generation. During the
`activating`, `corpus-activated`, or `metadata-activated` phases it waits for a
bounded interval; if activation does not settle it returns a typed busy result
rather than exposing a mixed corpus and metadata pair.

If the lease owner is stale, a reader may temporarily acquire the same writer
lease as `reader-recovery`, recover the journal, and then release it. Same-host
ownership uses PID liveness plus process-start identity to avoid PID reuse;
other-host ownership uses the heartbeat age conservatively. A malformed lock,
journal, pointer, or activation marker fails closed. Raw reads of
`knowledge/sources/**` are not a supported concurrent-read API; future corpus
consumers must enter through the stable reader boundary.

## Promotion concurrency

Promotion reads the source through its stable reader boundary and owns only the
destination writer lease while staging and activating the target generation.
Two promotions to the same target, or a promotion concurrent with ingestion to
that target, therefore serialize with the same busy/retry behavior. A source
writer is never allowed to be recovered by the promotion reader; it is either
read from its previous stable generation or reported busy during activation.

## Git TLS environment isolation

Remote repository checkout retains enterprise trust-anchor overrides
(`GIT_SSL_CAINFO`, `GIT_SSL_CAPATH`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, and
`CURL_CA_BUNDLE`) when supplied by the parent environment, but always keeps
certificate verification enabled. It strips `GIT_SSL_NO_VERIFY`, forced
protocol versions, weak cipher-list overrides, SSH/credential settings, and
all HTTP(S)/generic/Git proxy variables. Git is also invoked with explicit
`http.sslVerify=true`, default protocol and cipher settings, and blank HTTP and
HTTPS proxy configuration. Retaining a custom CA path changes the trust anchor,
not the requirement to verify the server certificate.

## Phase boundary

This phase intentionally does not implement connector authentication, OpenClaw
memory/search/embeddings/vector indexes, RAG, retrieval ranking, runtime context
injection, or new UX. Phase 2 closure also does not start Phase 3 or Phase 7
work; those require separate OpenClaw capability discovery and a new ownership
decision before implementation.

---
name: agentos-ui-ux
description: Design, review, or implement AgentOS UI and UX work using the project’s operator-console visual system. Use for React/Tailwind pages, cards, dialogs, mobile layouts, theme work, navigation, forms, empty/loading/error states, and UI consistency reviews in AgentOS.
---

# AgentOS UI and UX

Build calm, dense, trustworthy operator surfaces. AgentOS is the human control layer over OpenClaw: the UI must make real runtime state, ownership, failures, recovery, and next actions immediately understandable.

## Start with the existing system

1. Read `AGENTS.md` and `docs/agentos-codex-skill.md`.
2. Inspect the target surface and related components before designing anything new.
3. Reuse `components/ui/*`, `cn`, existing badges, buttons, dialogs, inputs, and mission-control patterns.
4. For dialog architecture, inspect `components/mission-control/mission-control-dialog-shell.tsx` first. It is the canonical bounded-desktop/full-screen-mobile shell; inspect `components/mission-control/context-engine-dialog.tsx` as a theme-aware example implementation and intentional multi-pane exception.
5. Keep all UI copy in English. Use real data and real actions; never add decorative controls that imply unavailable functionality.

## Design-System-First Decision Gate

Every meaningful AgentOS UI change must follow this order:

1. Identify the operator outcome and workflow.
2. Inspect the existing product surface and its closest neighboring flows.
3. Inspect existing interaction patterns and state/recovery behavior.
4. Inspect existing layout patterns and responsive behavior.
5. Inspect shared primitives in `components/ui/*`.
6. Inspect global and product-surface semantic tokens.
7. Reuse or extend the closest canonical pattern.
8. Create a new visual primitive only when the requirement cannot be represented correctly by the existing system, and record why.

Never design a new visual system directly from a feature requirement. First derive the UI from the existing AgentOS design system, interaction patterns, semantic tokens, and product-surface architecture. A new feature does not justify a new visual language. When a shared pattern is inadequate, improve that pattern instead of creating a disconnected one-off implementation.

For a significant change, complete the lightweight `AgentOS UI Decision` record below before implementation. Tiny copy, spacing, or local bug fixes do not need a separate record.

## UI Architecture Layers

Features should move down this hierarchy and compose the layers beneath them:

```text
FOUNDATIONS
color / typography / spacing / radius / motion / breakpoints / safe areas / themes
        ↓
PRIMITIVES
components/ui/* (Button / Dialog / Input / Select / Badge / Tooltip / Tabs / ScrollArea)
        ↓
PATTERNS
DialogShell / Panel / InsetPanel / Metric / StatusBadge / PageHeader / Toolbar /
ActionBar / EmptyState / ErrorState / DegradedState / RecoveryAction / SectionHeader /
EntityListRow / CompactCard
        ↓
PRODUCT SURFACES
Mission Control / Operations / Inspector / Runtime Inbox / Workspace Wizard / Settings
        ↓
FEATURE FLOWS
Create Agent / Configure Skills / Add Model / Connect Account / Create Workspace /
Approve Action / Recover Runtime
```

Foundations define semantic meaning and theme behavior. Primitives provide low-level accessible controls. Patterns encode repeated AgentOS interaction and layout grammar. Product surfaces may retain meaningful personality: Mission Control can be dense and operational, the Workspace Wizard can be guided, Secure Live View can prioritize viewport controls, and Settings can prioritize diagnostics. Feature flows compose these layers rather than bypassing them with a new visual system.

Do not create every named pattern up front. Extract a pattern only when duplication is clear, semantics match, the change reduces future drift, and runtime behavior remains unchanged.

## Canonical Dialog Architecture

`MissionControlDialogShell` is the primary reusable dialog reference. Its contract is:

- Overlay and close action are provided by the shared Radix dialog primitive.
- Desktop presentation is bounded, readable, theme-aware, and centered.
- Mobile task presentation uses the full viewport with `h-dvh`, `w-screen`, and no cramped desktop radius/border.
- The header owns identity, scope/context, supporting description, and header actions.
- The body owns the central scroll region; use `min-h-0 flex-1 overflow-y-auto` for a flex-based body.
- The footer owns persistent primary/secondary actions and remains reachable above the bottom safe area.
- Loading, disabled, destructive, degraded, and recovery states remain close to the action they explain.
- Theme values and focus/contrast behavior must be explicit in both light and dark modes.

`ContextEngineDialog` remains a reference implementation for local CSS-variable theming and a deliberate exception for a complex multi-pane inspector with a tab rail and editor-specific scroll ownership. A feature may diverge when its interaction model genuinely differs, but it must preserve the same accessibility, safe-area, state, and action-reachability contracts.

## Semantic Design Tokens

Use semantic tokens rather than repeating raw visual values. Global tokens live in `app/globals.css` and use the `agentos-*` vocabulary:

- Surfaces: `surface-base`, `surface-panel`, `surface-inset`, `surface-strong`.
- Borders: `border-default`, `border-subtle`.
- Text: `text-default`, `text-muted`, `text-subtle`.
- Interaction: `brand-primary`, `operational-accent`, `interactive-brand`, `interactive-operational`, `focus`.
- Status: `status-success`, `status-info`, `status-warning`, `status-danger`, `status-muted`.

Mission Control may define product-surface tokens such as `--mission-surface`, `--mission-panel`, `--mission-panel-strong`, `--mission-inset`, `--mission-border`, `--mission-text`, `--mission-text-muted`, and `--mission-accent`. These describe meaning and preserve Mission Control personality; they do not require every feature-local visual to become global.

The established accent ownership is:

- **Brand primary:** AgentOS rose/pink for global identity, selected global navigation, and global primary actions where appropriate.
- **Operational accent:** violet for Mission Control, agent/runtime interaction, operational dialogs, and runtime configuration.
- **Semantic status:** green for success, amber for warning/attention, red for failure/danger, and neutral for inactive/unknown/disabled. Blue/cyan require a specific informational or runtime meaning.

Do not use status colors as decoration. Feature-specific colors may remain local when they express a real surface identity or domain meaning.

## UI State Vocabulary

Use the shared vocabulary in `components/ui/design-system.ts` and preserve meaningful runtime distinctions:

| State | Meaning | Default tone | Action required | Recovery |
| --- | --- | --- | --- | --- |
| active | Operator or runtime is active and available | info | No | No |
| idle | No work is running but the surface is available | muted | No | No |
| pending | Waiting for a dependency, queue, or confirmation | warning | No | No |
| running | Work is in progress | info | No | No |
| success | Operation completed successfully | success | No | No |
| degraded | Usable with a limitation or reduced confidence | warning | Yes | Yes |
| blocked | Cannot continue until a dependency, approval, or policy issue is resolved | danger | Yes | Yes |
| unsupported | Current runtime or product surface does not support the capability | muted | Yes | No |
| unknown | State is not verified and must not look healthy | muted | Yes | Yes |
| failed | Operation did not complete successfully | danger | Yes | Yes |
| recovering | Recovery is in progress or the runtime is returning to usable state | warning | No | Yes |
| disabled | Intentionally disabled and will not act until enabled | muted | No | No |

OpenClaw technical states such as `native`, `degraded`, `unsupported`, `upstream-needed`, `recovery-cli`, and `unknown` must map to honest user-facing state and next-action semantics. Do not collapse them into a healthy-looking success state.

## Interaction Architecture

- Keep loading, empty, error, unavailable, degraded, blocked, success, and recovery states beside the affected data or operation.
- Place actions beside the item or state they affect.
- Preserve selection during refreshes whenever possible.
- Require confirmation for destructive actions and explain the real scope.
- For long-running operations expose progress, running state, completion/failure, cancellation only when genuinely supported, and recovery when available.
- Do not silently disable controls when the reason is non-obvious; explain the reason.
- Every control must work against real data, be disabled with a reason, or be clearly marked unavailable/coming soon. Never ship fake interactive UI.

## Responsive Architecture

- Complex task dialogs default to full-screen mobile presentation when bounded desktop layout would be cramped.
- Give each surface one deliberate scroll owner. Do not create competing outer and inner scroll regions without a strong interaction reason.
- Respect `safe-area-inset-top`, `safe-area-inset-right`, `safe-area-inset-bottom`, and `safe-area-inset-left` where headers, close controls, footers, or edge-pinned actions need them.
- Audit fixed widths, `min-width`, long IDs, code/preformatted blocks, forms, selects, tables, and action groups for horizontal overflow.
- On small screens reduce information in this order: remove redundant copy, collapse secondary metadata, simplify secondary actions, switch layout, then reduce typography if still necessary.
- Keep primary workflow actions reachable without relying on a trapped or competing scroll region.

## Accessibility Architecture

- All interactive controls must be keyboard reachable with a logical focus order, visible focus state, and no keyboard traps.
- Dialogs need sensible initial focus, focus containment from the Radix primitive, and focus restoration when closed.
- Icon-only actions require accessible labels; ambiguous controls require an accessible name; important visual-only status signals need a text equivalent.
- Light and dark themes must preserve readable contrast for content, controls, status, and focus indicators.
- Respect `prefers-reduced-motion`; do not make essential state communication depend on animation.
- Preserve reasonable touch target sizes on mobile.
- Expose important asynchronous status and error changes to assistive technology where relevant, using the existing Radix/shadcn primitives correctly.

## AgentOS UI Decision

For significant UI changes, record:

**User outcome:** What does the operator need to accomplish?

**Existing surface:** Which current AgentOS surface is closest?

**Existing pattern:** Which primitive or pattern should be reused?

**State model:** Which loading, empty, error, unavailable, degraded, blocked, success, and recovery states exist?

**Primary action:** What is the next meaningful action?

**Responsive model:** How does the flow behave on mobile, tablet, and desktop?

**Accessibility considerations:** Keyboard, labels, focus, motion, contrast, and touch.

**New primitive required?:** Yes or no. If yes, why can existing primitives not represent the requirement?

This is a design gate for meaningful work, not documentation overhead for tiny changes.

## Bounded Drift Audit

When reviewing UI architecture, inspect repeated panel styling, inset helpers, theme types, dialog shells, status badge logic, operational button classes, surface colors, empty/error/recovery panels, radii, and status-color usage. Consolidate only when duplication is clear, semantics match, the extraction reduces future drift, and runtime behavior remains unchanged. Keep feature-specific visual logic local when it expresses a genuine product-surface personality.

## Visual language

### Product character

- Prefer an operator console over a marketing dashboard: dense, quiet, legible, and purposeful.
- Use hierarchy through spacing, surfaces, type, and restrained color—not excessive borders, gradients, or badges.
- Let status colors communicate state. Do not use warning, danger, or success colors as generic decoration.
- Keep one primary action per active region. Secondary actions should be visually quieter.
- Keep button corners controlled and architectural. Default to `rounded-md` for standard buttons and avoid pill-like rounding unless the component has a strong semantic reason to stand out.

### Theme-aware surfaces

- Support dark and light themes intentionally. Do not rely on dark-only utility classes or broad light-theme overrides to rescue readability.
- For a complex dialog or standalone surface, define local CSS variables for surface, panel, strong panel, border, primary text, muted text, accent, and accent-soft. Follow the Context Engine pattern.
- In dark mode, use translucent panels over a restrained deep surface. In light mode, use warm/neutral opaque panels with sufficient text contrast.
- Prefer `bg-[var(--...)]`, `border-[var(--...)]`, and `text-[var(--...)]` inside a themed surface. Keep semantic state colors separate.
- Use violet as the standard primary interactive accent for new theme-aware modal work unless the existing feature owns a stronger semantic color.
- Give dense card collections a deliberate second surface tone. In light theme, establish contrast in the correct direction: use white or cream cards on a warm-gray parent panel, or warm-gray cards on a white parent panel. In dark theme, use a darker opaque or high-opacity card panel distinct from the base surface. Define local `--*-card`, `--*-card-strong`, and hover variables when the collection needs nested chips or metadata.

### Cards and density

- Cards need a clear job: grouping, status, or a bounded action. Avoid nesting cards solely for decoration.
- Use `min-w-0` on flex/grid children with text; truncate identifiers only when the full value remains available through context, title, or a detail view.
- Keep card headers compact. Hide supporting copy on small screens when the control remains self-explanatory.
- Put the action nearest to the item it affects. Do not place selected-item actions far below a long list.
- Treat counts as supporting evidence, not the main visual element.
- For compact, related cards, use a two-column mobile grid when each card remains readable at the narrowest supported width. Use short mobile action labels and preserve one-column layout for dense forms, long prose, or cards with several controls.

## Dialog and mobile standard

### Desktop dialogs

- Preserve a bounded, readable width and a clear header/content/footer hierarchy.
- Header: identity, current scope, concise supporting context, close action.
- Content: only the central region scrolls (`min-h-0 flex-1 overflow-y-auto`).
- Footer: persistent actions, separated with a subtle border.

### Mobile dialogs

- Use full screen by default for task-oriented dialogs:
  `h-dvh max-h-dvh w-screen max-w-none rounded-none border-0`.
- Restore the bounded desktop presentation with `sm:` classes.
- Respect `safe-area-inset-top`, `safe-area-inset-right`, and `safe-area-inset-bottom` for headers, close controls, and footers.
- Never allow the whole modal and an inner list to compete for scrolling. Keep a single deliberate scrolling body.
- Keep primary and secondary footer actions reachable. When the actions are peers, render them side by side on mobile with equal visual weight; use a full-width primary action only when it is the sole meaningful next step.
- Replace desktop sidebars with compact horizontal tabs, segmented controls, or a horizontal selection rail. Do not leave a tall sidebar above the mobile detail area.
- Remove desktop-only supporting descriptions and redundant counters before reducing type sizes.
- Audit fixed widths, `min-w-*`, long IDs, select controls, preformatted blocks, and action groups for horizontal overflow.

## Workflow and interaction rules

- Preserve the user’s current selection when refreshing related data.
- When selecting an item opens configuration below the fold, scroll the relevant settings area into view on mobile/tablet.
- Show loading, empty, unavailable, error, and success states close to the action or data they describe.
- Explain disabled actions with a concrete reason when the reason is not obvious.
- Use confirmation dialogs for destructive or configuration-writing actions; describe the scope of the real operation honestly.
- Keep retry and recovery actions near observable failure state.

## Implementation checklist

Before finishing UI work, verify:

- The intended dark and light theme values are both explicit and readable.
- Small-screen layout has no horizontal overflow and no unreachable footer action.
- The visual hierarchy identifies the active item, current state, and next meaningful action within one viewport where practical.
- Buttons, filters, links, status pills, and dialogs are all connected to real behavior, disabled with a reason, or clearly unavailable.
- Existing shared primitives were reused before adding a new one.
- UI copy is concise English and does not imply unsupported OpenClaw behavior.
- A focused source, component, or interaction test was updated when practical.

Run `pnpm typecheck`, `pnpm lint`, and `git diff --check`. Use browser/device inspection when the task depends on responsive layout, overflow, or visual hierarchy.

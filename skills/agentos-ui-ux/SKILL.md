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
4. For dialog styling, inspect `components/mission-control/context-engine-dialog.tsx` first. It is the reference surface for theme-aware modal hierarchy.
5. Keep all UI copy in English. Use real data and real actions; never add decorative controls that imply unavailable functionality.

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

---
title: "ADR-002: API Evolution"
parent: Architecture
nav_order: 5
---

# Extension API Evolution for Agentic Orchestration

Date: 2026-04-14
Status: Accepted

## Context

GnarTerm's extension system (ADR-001) established a registry pattern and a sandboxed ExtensionAPI with read-only stores, a typed event bus, and an allow-listed set of Tauri commands. The system was designed for extensions that contribute UI and respond to lifecycle events — a read-heavy, contribute-and-observe model.

Agentic orchestration features now require extensions to do more: track state across multiple surfaces, mutate core UI indicators, communicate structured data between extensions, and invoke new native operations (merge, notifications). These needs push beyond the original API boundary in four areas.

## Decision Drivers

- Extensions must monitor multiple agent harnesses across workspaces and navigate between them
- Agent presets require structured array data that the settings schema (string/number/boolean/select) cannot represent
- Tab badges (unread indicators) are currently settable only by terminal-service in core — extensions cannot signal "attention needed"
- Cross-extension coordination (orchestrator ↔ worktree-workspaces ↔ diff-viewer) needs a stable event contract
- New git operations (merge, branch diff) and desktop notifications require Rust-side additions

## Considered Options

### Option A: Extension State for Complex Configuration

Use `api.state` (arbitrary JSON, persisted to `~/.config/gnar-term/extensions/<id>/state.json`) for data types that exceed the settings schema, paired with extension-provided overlay UIs for editing.

- Good, because `api.state` already supports arbitrary JSON with debounced persistence
- Good, because project-scope already proves this pattern (`ProjectEntry[]` in state)
- Good, because it requires zero changes to the settings schema or core settings UI
- Bad, because state-backed configuration is invisible in the Settings overlay — users must find the extension's custom UI

**Alternative A1: Extend settings schema with array/object types.** Rejected — requires changes to ExtensionSettingsField, the JSON Schema form renderer, and the config persistence layer. Disproportionate scope for one extension's needs.

**Alternative A2: JSON string in a settings text field.** Rejected — exposes raw JSON to users, hostile UX, error-prone.

### Option B: Core API Methods for Extension-Driven UI Mutation

Add `markSurfaceUnread(surfaceId)` and `focusSurface(surfaceId)` to ExtensionAPI, allowing extensions to set tab badges and navigate to specific surfaces across workspaces.

- Good, because it follows the existing API pattern (extensions call methods, core owns the mutation)
- Good, because `hasUnread` already exists on the Surface type — this just exposes a setter
- Good, because `focusSurface` composes existing operations (workspace switch + pane focus + surface select)
- Bad, because it crosses a new boundary — extensions now mutate core UI state, not just contribute to it

**Alternative B1: Core listens for extension events and sets unread.** Rejected — creates coupling where core must know about specific extension event shapes.

### Option C: Cross-Extension Event Contracts as Public API

Document `extension:harness:statusChanged` and `extension:worktree:merged` as stable event contracts with defined payload shapes. Subscribing extensions declare these events in their manifests.

- Good, because the event bus already supports cross-extension events with deny-by-default filtering
- Good, because no code changes are needed — this is a documentation and convention decision
- Good, because third-party extensions can participate by emitting conforming events
- Bad, because it creates implicit manifest coupling (extension A must declare extension B's event name)
- Bad, because there is no versioning or compatibility checking for event shapes

**Alternative C1: Add `extensionDependencies` to the manifest with load-order enforcement.** Rejected — over-engineering for 2-3 collaborating extensions. The event bus already handles late subscribers correctly (events are runtime, not activation-time).

### Option D: New Rust Commands and Tauri Plugin

Add `git_merge` (with conflict detection and auto-abort), extend `git_diff` with `base`/`head` parameters, and add `tauri-plugin-notification` for desktop notifications.

- Good, because dedicated Rust commands provide structured error handling (conflict file lists, merge abort)
- Good, because the notification plugin is the standard Tauri approach with proper OS integration
- Bad, because each new Rust command increases the backend surface area and must be added to the extension allow-list

**Alternative D1: Use `run_script` for git merge.** Rejected — bypasses the command allow-list audit trail and returns unstructured string output.

## Decision Outcome

All four options are accepted as complementary changes:

**Option A** — `api.state` for complex configuration (presets, session logs). Extensions that need structured data beyond the settings schema use state + custom overlay UIs. This is now an established pattern, not an exception.

**Option B** — `markSurfaceUnread(surfaceId)` and `focusSurface(surfaceId)` added to ExtensionAPI. These are the first extension-to-core mutation methods (beyond registration). Future API additions in this category should follow the same pattern: core owns the state mutation, extensions request it by ID.

**Option C** — Event contracts documented in EXTENSIONS.md as public protocols. Event shapes include `previousStatus` fields following the core convention (see `surface:titleChanged`, `workspace:activated`). No formal versioning yet — breaking changes will be handled as semver-major extension updates.

**Option D** — `git_merge` and extended `git_diff` added to the Rust backend and extension allow-list. `tauri-plugin-notification` added as a Rust dependency with a corresponding extension API method or Tauri command.

### Consequences

**Good:**

- Extensions can build rich multi-surface workflows (agent dashboards, jump-to-waiting) without core changes per feature
- The `api.state` + overlay pattern is reusable for any extension needing complex configuration
- Cross-extension events enable a composable extension ecosystem where extensions enhance each other without hard dependencies
- Git merge and branch diff unlock worktree-based workflows (merge-and-archive, diff review)

**Bad:**

- `api.state` configuration is less discoverable than settings — users must know to look for the extension's overlay UI
- `markSurfaceUnread` and `focusSurface` are the first methods where extensions mutate core state — this boundary will need monitoring for abuse as the API grows
- Cross-extension event contracts are implicit (no compiler or runtime enforcement of payload shapes) — a rename or shape change silently breaks subscribers
- Adding `tauri-plugin-notification` increases the Rust dependency tree and binary size

## Links

- [ADR-001: Extension Architecture](001-extension-architecture.md) — establishes the extension system this ADR evolves
- [EXTENSIONS.md](../../EXTENSIONS.md) — public API reference (to be updated with new methods and event contracts)
- [Registry System](../registry-system.md) — registry pattern that the new API methods compose with

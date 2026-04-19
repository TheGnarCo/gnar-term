---
title: "ADR-003: Content Boundary"
parent: Architecture
nav_order: 6
---

# ADR-003: Extension Content Boundary

Date: 2026-04-14
Status: Accepted & Implemented
Implementation: Preview migration completed (commit e238215).

## Context

GnarTerm's extension system (ADR-001) established a sandboxed API and registry pattern. Extensions register content types (surface types, sidebar tabs, commands, context menu items) through the ExtensionAPI. Core provides infrastructure: registries, event bus, stores, and the Tauri command bridge.

However, the preview subsystem (`src/preview/`) violates this boundary. Core registers 8 content-type previewers (markdown, JSON, image, PDF, CSV, YAML, video, text), a preview surface type, and a preview component — all with `source: "core"`. This is functionally identical to what extensions do, but bypasses the extension lifecycle, permissions, and cleanup mechanisms.

An audit of all other features found no additional violations — sidebar tabs, commands, workspace actions, overlays, and non-terminal surface types are all extension-owned.

## Decision

**Core provides infrastructure. Extensions provide all content.**

Specifically:

1. **Core owns:**
   - Terminal surface type (the fundamental unit of a terminal app)
   - Registries (commands, surface types, sidebar tabs, overlays, etc.)
   - Event bus, stores, and the ExtensionAPI construction
   - Tauri command bridge and permission enforcement
   - Workspace/pane/surface lifecycle management

2. **Extensions own everything else:**
   - All non-terminal surface types (preview, diff, harness, custom viewers)
   - All sidebar tabs and sections (files, agents, GitHub, changes, projects)
   - All content-type detection and rendering
   - All context menu items beyond core clipboard/terminal operations

3. **The boundary test:** If a feature could be disabled without breaking workspace/pane/terminal management, it belongs in an extension.

## Consequences

### Preview System Migration

The preview subsystem must move from `src/preview/` into the preview extension (`src/extensions/preview/`):

- **Previewer registry** (`registerPreviewer`, `canPreview`, `openPreview`): Moves to a service that the preview extension owns. Core exposes the ability to register surface types (already available via `api.registerSurfaceType()`), but the file-type-to-renderer mapping is extension logic.
- **8 previewer modules** (markdown, json, image, pdf, csv, yaml, video, text): Move into the extension.
- **PreviewSurface.svelte**: Moves from `src/lib/components/` into the extension.
- **Core imports** in App.svelte and terminal-service.ts: Replaced with extension API calls or removed.

### API Changes Required

The preview extension needs one new capability that the current ExtensionAPI doesn't provide: the ability to respond to "open file as preview" requests from other code paths (terminal context menu, command palette). This requires either:

- A core "file opener" registry that extensions can register handlers for, or
- Routing preview requests through the command system (existing infrastructure)

### No Other Migrations Needed

The audit confirmed no other boundary violations exist. All non-terminal content types are already extension-owned:

- `diff-viewer`: Registers its own surface type via the extension API
- `agentic-orchestrator`: Registers harness surface type via the extension API
- `file-browser`, `github`, `profile-card`, `project-scope`: All use extension registrations

### Enforcement

New code that registers content types with `source: "core"` (other than terminal) should be flagged in code review. The extension barrier (ADR-001) already prevents extensions from importing core internals — this ADR adds the inverse rule: core should not implement what extensions should own.

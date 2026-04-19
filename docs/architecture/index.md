---
title: Architecture
nav_order: 6
has_children: true
---

# Architecture

Internal design documentation for GnarTerm's core systems. These pages are useful for contributors and extension authors who want to understand how things work under the hood.

| Document                                     | Description                                              |
| :------------------------------------------- | :------------------------------------------------------- |
| [Glossary](glossary)                         | Canonical definitions for terms used across the codebase |
| [Registry System](registry-system)           | How the store-backed registry pattern works              |
| [Sidebar Architecture](sidebar-architecture) | Dual-sidebar layout rules and guidelines                 |
| [ADR-001: Extension Architecture](adr-001)   | Why we built the extension system                        |
| [ADR-002: API Evolution](adr-002)            | Badges, indicators, and cross-extension events           |
| [ADR-003: Content Boundary](adr-003)         | Core owns infrastructure, extensions own content         |

## Architecture Decision Records

| ADR                                                 | Title                      | Status   | Summary                                               |
| :-------------------------------------------------- | :------------------------- | :------- | :---------------------------------------------------- |
| [ADR-001](../adr/001-extension-architecture.md)     | Extension Architecture     | Accepted | Why we built the extension system                     |
| [ADR-002](../adr/002-extension-api-evolution.md)    | API Evolution              | Accepted | Badges, indicators, and cross-extension events        |
| [ADR-003](../adr/003-extension-content-boundary.md) | Extension Content Boundary | Accepted | Extensions own preview/diff content via surface types |

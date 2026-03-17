# AGENTS.md

This repository defines a desktop-first agent workspace focused on coding, orchestration, and low-overhead local execution.

## Product Direction

- Build a desktop app with a polished web interface and GUI support.
- Support Windows, Linux, and macOS.
- Favor smooth, incremental rendering with no flickering.
- Be performance-minded, but not benchmark-maxxed.
- Stay reasonable on CPU and RAM usage.
- Treat model differences as first-class: different models have different personalities, strengths, and tool behavior.
- Include MCP, tool search, subagents, async subagents, fork, and A2A by default, while keeping them optional and toggleable.
- Include the built-in tools needed for coding, with per-workspace or per-session controls.
- Maintain compatibility with Claude-style and Codex-style harnesses and tool specs.
- Support incremental compaction and handoff.
- Work well as an interface for driving other clients.

## Current Implementation Target

The current milestone is `v0.1`.

### v0.1 Scope

- Single session flow.
- Multi-provider support.
- Basic built-in tools.
- Basic MCP integration.
- Basic transcript UI and storage.

### v0.1 Delivery Notes

- Keep architecture simple and local-first.
- Prefer stable primitives over advanced orchestration.
- Do not introduce multi-session management yet.
- Do not introduce advanced subagent workflows yet.
- Do not optimize for benchmark demonstrations.

## Version Roadmap

### v0.1

- Single session.
- Multi-provider adapters.
- Basic tools.
- Basic MCP.
- Basic transcript.

### v0.2

- Subagents.
- Forked sessions.
- Resource controls.
- Initial compaction and handoff.

### v0.3

- External client bridge.
- A2A support.
- Expanded permissions.
- Model-profile-aware routing and defaults.

### v0.4

- Workspaces and templates.
- Better observability.
- Crash recovery.
- Import and export.

## Implementation Bias

- Prefer low-overhead desktop architecture.
- Keep UI responsive under streaming output.
- Use incremental updates instead of full rerenders.
- Keep defaults powerful, but make advanced features optional.
- Preserve compatibility layers behind a unified internal event model.

# Forge

A local-first desktop workspace for building, running and sharing AI agents.

Forge organizes everything around one concept: the **GAP — Global Agent Pack**.
A GAP is a self-contained, shareable bundle of one or more agents together with
the skills, knowledge, connectors and configuration they need to run. You build
GAPs, install them from the Marketplace, run them, and publish them — each GAP
round-trips to a single `.gap` file.

## Why Forge

- **Local-first.** Your GAPs, chats and keys live on your machine. No account,
  no hosted backend, no cloud. Chat goes straight from the app to Claude —
  via your API key, or via your local Claude Code subscription. Credentials go
  in the OS keychain, never in a config file or a backup.
- **In-built bridge.** The Claude Code runtime is compiled into the app's Rust
  shell — one-tap connect (it can even install the CLI for you), $0 API cost.
- **GAP-native.** Agents are never loose — they live inside a GAP you can
  export, version and share.
- **Real desktop app.** Built on Tauri 2 (Rust + a web UI), so it's small, fast
  and native, with a true terminal PTY built in.

## Stack

- **Shell:** Tauri 2 (Rust)
- **UI:** React 19 + TypeScript + Vite + Tailwind
- **State:** Zustand (persisted locally)
- **AI:** Claude API (BYOK) or the local Claude Code CLI, streaming; MCP
  servers per pack on the CLI runtime

## Develop

```bash
pnpm install

# Web build (fastest iteration, runs in a browser at http://localhost:1620)
pnpm dev

# Native desktop app (requires the Rust toolchain)
pnpm desktop
```

Add your Claude API key during onboarding or in **Settings → Claude API**.

## Layout

```
src/
  views/        screens (Home, GAPs, Agents, Brains, Workshop, Memory, …)
  components/    Shell, UI primitives, Markdown, icons
  stores/        Zustand stores (gaps, brains, memory, conversations, runs, …)
  lib/           Claude client, Claude Code runtime, MCP config, knowledge,
                 .gap import/export, seed
  hooks/         useChat / useClaudeCode orchestration
  types/         domain model (Gap, Agent, Brain, McpServer, …)
src-tauri/       Rust shell: Claude Code bridge (detect / install / run),
                 PTY terminal, channel runtimes, HTTP proxy
```

## Features

- **GAPs** — create, edit, import/export `.gap`, share codes, install from
  Marketplace
- **Workshop** — pack builder wizard plus a deep pack editor: identity,
  agents, MCP servers, environment variables, raw-manifest escape hatch
- **Agents** — chat (streaming, tool-use loop), system prompt, model &
  sampling, skills, per-agent knowledge (local semantic RAG), connectors,
  channels, run logs
- **Brains** — detachable minds: persona, model overrides, knowledge and
  shared memory, attachable to any agent and movable between them; an
  optional learning queue holds new facts until you approve them
- **Claude Code runtime** — in-built bridge to the local CLI: one-tap connect
  or in-app install, $0 API cost, pack MCP servers + env mounted per turn
- **Memory** — workspace-wide browser over every agent's memory and every
  shared brain pool, with search and inline review
- **Architect** — describe a goal, Claude designs a GAP you can install
- **Marketplace** — browse and install community GAPs
- **Schedules** — cron routines per agent
- **Runs & Observability** — token/cost accounting, spend charts
- **Terminal** — a real shell (desktop only)
- **Settings** — BYOK key, default model, theme, price overrides, data reset

## Test

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
```

Note: never emit JavaScript into `src/`. Vite resolves `.js` before `.ts`, so a
stray artifact silently shadows its own source and the build ships stale code.
`.gitignore` blocks `src/**/*.js` for that reason.

## Build for release

```bash
pnpm desktop:build                                  # local, unsigned (.app + .dmg)
pnpm tauri build --target universal-apple-darwin    # Intel + Apple Silicon
pnpm desktop:release                                # signed build with auto-update
```

`desktop:release` and CI need signing keys. See [RELEASE.md](RELEASE.md) for the
one-time Apple Developer and updater-keypair setup, and for cutting a tagged
release through GitHub Actions.

## License

Copyright © 2026. All rights reserved. This source is proprietary and is not
licensed for redistribution or derivative works.

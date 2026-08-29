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
  via your API key, or via your local Claude Code subscription. Credentials stay
  on the device and are stripped out of exported backups.
- **In-built bridge.** The Claude Code runtime is compiled into the app's Rust
  shell — it detects the local CLI automatically and installs it for you from
  Settings if it's missing. $0 API cost.
- **GAP-native.** Agents are never loose — they live inside a GAP you can
  export, version and share.
- **Real desktop app.** Built on Tauri 2 (Rust + a web UI), so it's small, fast
  and native, with a true terminal PTY built in.
- **Self-contained.** One installer, no update server, no account, no telemetry.

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
- **Claude Code runtime** — in-built bridge to the local CLI: auto-detect or
  in-app install, $0 API cost, pack MCP servers + env mounted per turn
- **Computer** — an opt-in per-agent skill giving it `run_shell` and
  `write_file` on the client's machine. Every single call opens an approval
  dialog showing the exact command or path; denial is the default, and headless
  paths (schedules, channels) always deny because nobody is at the keyboard.
  File access is scoped to `$HOME` with credential folders (`.ssh`, `.aws`,
  `.gnupg`, gcloud) blocked outright
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

## Build the installer

```bash
CI=true pnpm desktop:build                                  # .app + .dmg for this architecture
CI=true pnpm tauri build --target universal-apple-darwin    # Intel + Apple Silicon in one bundle
```

`CI=true` is not optional on macOS unless you have granted your terminal
Automation access to Finder. The DMG bundler otherwise runs AppleScript to
position icons in the mounted volume, and a terminal without that permission
fails the whole build with `Not authorised to send Apple events to Finder
(-1743)` — after the `.app` has already been built, which makes it look like a
compile failure when it is a privacy prompt that never appeared. `CI=true`
passes `--skip-jenkins` to the bundler, which skips the cosmetic step; the
resulting DMG is functionally identical, just without custom icon positions.

Bundles land in `src-tauri/target/release/bundle/`. Forge is a self-contained
application: there is no update server, no license check and no telemetry. Build
it once and hand the installer over.

Two things still need the network at runtime, because they are inherent to what
the app does rather than to how it ships:

- **Talking to Claude**, via the API or the local Claude Code CLI.
- **Semantic knowledge search**, which downloads its embedding model
  (~25 MB, `Xenova/all-MiniLM-L6-v2`) once on first use and caches it. Until
  then — and on a machine that stays offline — retrieval falls back to the
  built-in keyword search automatically. Nothing errors.

### Giving the installer to someone else

The bundle is not code-signed, so macOS Gatekeeper blocks it on a machine that
did not build it. The recipient opens it once with **right-click → Open →
Open**, or you clear the quarantine flag before sending:

```bash
xattr -cr /path/to/Forge.app
```

To remove that step entirely, sign with a Developer ID before distributing —
Tauri picks the identity up from the environment, no project config needed:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: You (TEAMID)" pnpm desktop:build
```

## License

Copyright © 2026. All rights reserved. This source is proprietary and is not
licensed for redistribution or derivative works.

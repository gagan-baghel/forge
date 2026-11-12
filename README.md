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
- **Self-contained.** One installer, no account, no telemetry. Updates come
  straight from this repo's GitHub Releases — no server of our own.

## Install

**For anyone who just wants to use Forge.** No Node, no Rust, no terminal.

1. Open [Releases](https://github.com/gagan-baghel/forge/releases) and download
   `Forge_x.y.z_universal.dmg`.
2. Open the DMG, drag **Forge** into Applications.
3. Launch it.

Every tagged version is built by CI and attached to a release automatically
(`.github/workflows/release.yml`), so there is nothing to build by hand.

### Updates

Forge checks for a new release on launch and every six hours. When one is
out, an **Update** button appears at the bottom of the sidebar (and in
Settings); one click downloads it, checks its signature, installs and
restarts. Updates are signed: an installed Forge refuses any build not signed
with the project's key.

Copies older than 1.0 have no updater — install 1.0 from Releases once by
hand, and every later version arrives in-app.

### Website

The project site is the static page in `docs/`: what Forge is, and a
download button pointing at the latest release. `vercel.json` tells Vercel
to publish just that folder. Forge itself is a desktop app; it is never
deployed to the web (`pnpm dev` runs it in a browser for development only).

## Release a new version

```bash
pnpm release          # 1.0.0 → 1.0.1  (or: pnpm release minor / major)
```

That bumps the version, tags it and pushes. CI builds the universal app,
signs the update, and publishes it with a `latest.json` feed; installed copies
pick it up within six hours, or immediately from **Settings → Check for
updates**.

One-time setup: the signing key lives at `~/.tauri/forge-updater.key` (keep
it secret and backed up — without it you can't ship updates to existing
installs). CI needs it as a repository secret:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/forge-updater.key
```

### The first-launch warning

Until Forge is signed with an Apple Developer ID, macOS will refuse the first
launch: *"Forge is damaged and can't be opened"* or *"cannot be opened because
Apple cannot check it for malicious software."* The app is fine — macOS says
this about every app from a developer who has not paid Apple's $99/year fee.

To open it anyway on macOS 13–15: launch Forge once and let it be blocked, then
go to **System Settings → Privacy & Security**, scroll to the bottom, and click
**Open Anyway** next to the message about Forge. Confirm. This is needed once,
not on every launch.

That step is the one thing standing between this and a genuinely
non-technical install, and it cannot be removed from the app's side — it needs
an Apple Developer Program membership. Once there is one, add the six `APPLE_*`
secrets to the repository and the existing release workflow signs and notarises
every build with no code change; the warning then disappears entirely.

## Stack

- **Shell:** Tauri 2 (Rust)
- **UI:** React 19 + TypeScript + Vite + Tailwind
- **State:** Zustand (persisted locally)
- **AI:** Claude API (BYOK) or the local Claude Code CLI, streaming; MCP
  servers per pack on the CLI runtime

## Develop

Needs Node 22.19+ (`.nvmrc` pins 24) and pnpm 10.

```bash
nvm use
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
  views/        screens (Workbench, Agents, Packs, Knowledge, Activity, …)
  components/    Shell, UI primitives, Markdown, icons
  stores/        Zustand stores (gaps, memory, conversations, runs, …)
  lib/           Claude client, Claude Code runtime, MCP config, knowledge,
                 .gap import/export, seed
  hooks/         useChat / useClaudeCode orchestration
  types/         domain model (Gap, Agent, McpServer, …)
src-tauri/       Rust shell: Claude Code bridge (detect / install / run),
                 Forge tool bridge (loopback MCP server), Telegram/Discord
                 bots, desktop control, PTY terminal, HTTP proxy
```

## Features

One home for each idea: a **pack** holds **agents**; an agent owns its
model, prompt, skills, **knowledge** (documents + memory), connections and
remote channels. Nothing overrides an agent from somewhere else.

- **Workbench** — what's live, what ran, what it cost, and what's left to set up
- **Agents** — chat (streaming, tool-use loop), setup (prompt, model,
  runtime), skills, knowledge, connections, remote channels and activity
- **Packs** — one page per pack: its agents, details, MCP servers,
  environment, sharing (`.gap` file or share code) and a raw-JSON escape
  hatch. New packs come from the step-by-step builder or the **Architect**
  (describe a goal, Claude designs the pack); ready-made ones from the
  **Marketplace**
- **Knowledge** — *Documents* agents read before answering (PDF, text,
  Markdown, CSV, JSON — read on this machine, matched with local semantic
  search) and *Memory*, the short facts an agent keeps across conversations.
  Add either by hand; agents with the Memory skill also save facts
  themselves, optionally waiting for your OK. The relevant ones reach the
  agent before every answer
- **Skills** — web search and full-page reading, JavaScript and a Python
  sandbox, file browsing and reading, HTTP, memory, and **Computer**: an
  opt-in skill giving `run_shell`, `write_file`, `send_file` and desktop
  control (`screenshot`, `click`, `type_text`, `press_key`, `scroll`). Every
  machine action asks first, showing the exact command, path or keystrokes;
  denial is the default. File access is scoped to `$HOME` with credential
  folders (`.ssh`, `.aws`, `.gnupg`, gcloud) blocked outright
- **Claude Code runtime** — in-built bridge to the local CLI: auto-detect or
  in-app install, $0 API cost, pack MCP servers + env mounted per turn
- **Remote** — message any agent from your phone over Telegram or Discord and
  have it work on this Mac (see below)
- **Schedules** — cron routines per agent; minutes missed while the window
  was throttled are caught up
- **Activity** — every run with token and cost accounting, plus spend and
  reliability over time
- **Terminal** — a real shell (desktop only)
- **Settings** — runtime, API key, default model, theme, price overrides,
  backup and reset

Packs you import from someone else arrive with channels, tokens and paired
phones stripped and every MCP server switched off until you've reviewed it.

## Remote control from your phone

Connect an agent to a Telegram or Discord bot (**Remote → Connect an agent**,
or the agent's Remote tab), pair your phone, and message it from anywhere —
"find the invoice PDF from last week and send it to me", "run the test suite
and tell me what failed", "open Figma and screenshot the dashboard".

- **Pairing.** A bot only answers people you pair. Press **Pair a phone** and
  send the one-time `/pair 123456` code to the bot. Codes expire after 10
  minutes, work once, and burn after 5 wrong guesses; everyone else gets a
  refusal and shows up in the Remote activity log.
- **Remote control** (per bot, off by default). With it on, the agent may run
  commands, edit files, look at the screen, click and type — and **every
  action is sent to your phone first** with *Approve*, *Allow 15 min* and
  *Deny* buttons (Discord: reply yes / trust / no). *Allow 15 min* opens a trust
  window for that chat: actions run without asking but are still announced, and
  anything proposed after the agent read outside content (a web page, a file,
  command output) asks again regardless. `/lock` ends the window early.
- **Commands.** `/status`, `/stop`, `/new`, `/screenshot`, `/lock`, `/unpair`.
- **Files both ways.** Send a file or photo to the bot and it lands in
  `~/Downloads/Forge`; ask for one and the agent sends it back.
- **Same conversation everywhere.** A phone thread is a normal conversation in
  the agent's chat list, streaming live on the desktop.
- **Schedules report to you.** A routine on an agent with a paired phone
  delivers its result there, and any approval it needs goes there too.
- **Stays reachable.** Bots that were live come back when Forge starts, the
  Mac is kept awake while remote control is live (toggle on the Remote page),
  and closing the window keeps Forge running — ⌘Q quits.
- **macOS permissions.** Seeing the screen needs *Screen Recording*; clicking
  and typing need *Accessibility*. The Remote page has buttons that open both.

Both runtimes get the same gate. On the Claude API runtime Forge runs the
tools itself. On the Claude Code runtime Forge serves a loopback MCP endpoint
per run (`src-tauri/src/bridge.rs`, bearer-secret protected) that exposes the
agent's Forge tools — memory, connectors, desktop control, `send_file` — and
answers the CLI's `--permission-prompt-tool`, so every Bash/Write/Edit the CLI
wants goes through the in-app dialog or your phone. Unattended runs with no
phone to ask still have the CLI's machine tools withheld.

Bot tokens, webhooks, paired phones and connector tokens never leave the
device: they are stripped from exported `.gap` files, share codes and backups
(restoring a backup keeps this device's own).

## Test

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
cd src-tauri && cargo test                        # Rust unit tests
cd src-tauri && cargo test -- --ignored --nocapture  # live Claude Code smoke tests (uses your subscription)
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
application: no license check and no telemetry. Local builds don't need the
update-signing key; only the CI release build signs update archives.

Three things use the network at runtime, because they are inherent to what
the app does rather than to how it ships:

- **Talking to Claude**, via the API or the local Claude Code CLI.
- **Update checks** against this repo's GitHub Releases.
- **Semantic knowledge search**, which downloads its embedding model
  (~33 MB, `Xenova/bge-small-en-v1.5`) once on first use and caches it. Until
  then — and on a machine that stays offline — retrieval falls back to the
  built-in keyword search automatically. Nothing errors.

### Signing without an Apple Developer account

Every build is ad-hoc signed (`bundle.macOS.signingIdentity: "-"` in
`tauri.conf.json`): Apple's free signature, which seals the whole app. A
**copy built on your own Mac opens with no warning at all**, because it was
never downloaded. A **downloaded** copy shows *“Forge” Not Opened* once;
System Settings → Privacy & Security → **Open Anyway** clears it for good, and
updates installed from inside Forge don't ask again. Removing that one prompt
for downloads needs Apple's paid Developer Program (notarization).

To install a build from your own checkout:

```bash
pnpm tauri build --bundles app
ditto src-tauri/target/release/bundle/macos/Forge.app /Applications/Forge.app
```

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

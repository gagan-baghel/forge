# Releasing Forge

`pnpm desktop:build` produces a working, **unsigned** app for local use. A
public release needs two extra things: an Apple Developer ID (so macOS will
open it) and an updater keypair (so installed copies can update themselves).

Both involve private keys, so they are the two steps you have to do yourself.
Everything downstream is already wired.

---

## One-time setup

### 1. Generate the updater keypair

```bash
pnpm tauri signer generate -w ~/.tauri/forge.key
```

Use a passphrase. This prints a **public key** and writes the **private key**
to `~/.tauri/forge.key`.

- Paste the public key into `pubkey` in `src-tauri/tauri.release.conf.json`.
- Replace `OWNER/REPO` in the same file's `endpoints` URL with your GitHub repo.
- Never commit the private key. If you lose it, existing installs can never be
  updated again — they only trust signatures from that one key.

### 2. Apple Developer ID

You need a paid Apple Developer account ($99/yr). In Certificates → **Developer
ID Application**, create a certificate, then export it from Keychain Access as
a `.p12` with a password.

```bash
base64 -i DeveloperID.p12 | pbcopy   # value for the APPLE_CERTIFICATE secret
```

Create an app-specific password at appleid.apple.com → Sign-In and Security →
App-Specific Passwords. That is `APPLE_PASSWORD` — not your Apple ID password.

### 3. Add the GitHub repository secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/forge.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its passphrase |
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-character team ID |

Find the identity string with `security find-identity -v -p codesigning`.

---

## Cutting a release

Keep the version in `package.json` and `src-tauri/tauri.conf.json` identical —
the updater compares against the Tauri version, and the UI shows the npm one.

```bash
npm version 0.1.1 --no-git-tag-version
```

Then bump `version` in `src-tauri/tauri.conf.json` to match, commit, and tag:

```bash
git commit -am "Release 0.1.1" && git tag v0.1.1 && git push origin main --tags
```

The `Release` workflow builds macOS (universal), Linux and Windows, signs and
notarizes the macOS bundle, and opens a **draft** release with `latest.json`
attached. Review it, then publish — installed copies pick up the update on
their next check.

---

## Verifying a signed build

```bash
spctl -a -vv /Applications/Forge.app
```

`accepted` and `source=Notarized Developer ID` means Gatekeeper is happy. The
local unsigned build reports `rejected`, which is expected.

---

## Notes

- Auto-update only works in builds made through `desktop:release` or CI; the
  plain `desktop:build` has no updater config, by design, so local builds keep
  working without any keys.
- Windows bundles are unsigned unless you add an Authenticode certificate.
  SmartScreen will warn until the download builds reputation.
- Bot tokens for Telegram/Discord live inside the GAP document, so a `.gap`
  file you share includes them. Strip channels before publishing a pack.

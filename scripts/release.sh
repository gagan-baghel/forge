#!/usr/bin/env bash
# Cut a release: bump the version, tag it, push. CI builds, signs and
# publishes it, and every installed Forge then offers it as an update.
#   pnpm release            1.0.0 → 1.0.1
#   pnpm release minor      1.0.0 → 1.1.0
set -euo pipefail
bump="${1:-patch}"
case "$bump" in patch|minor|major) ;; *) echo "usage: pnpm release [patch|minor|major]" >&2; exit 1 ;; esac
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first — a release is built from what's committed." >&2
  exit 1
fi
pnpm version "$bump" -m "Release v%s"
git push --follow-tags
echo "Pushed $(git describe --tags). Watch the build: gh run watch"

#!/usr/bin/env bash
# Overmind launcher: installs deps on first run, starts the dev server, and
# opens the app in the default browser.
set -e

cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not on PATH. Install Node.js 22 from https://nodejs.org/ and reopen this terminal." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

exec npm run dev -- --open

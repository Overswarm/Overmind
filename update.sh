#!/usr/bin/env bash
# Overmind updater: fetches the latest code from git and reinstalls deps so a
# subsequent ./run.sh uses the new version.
set -e

cd "$(dirname "$0")"

if ! command -v git >/dev/null 2>&1; then
  echo "git is not on PATH. Install git and reopen this terminal." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not on PATH. Install Node.js 22 from https://nodejs.org/ and reopen this terminal." >&2
  exit 1
fi

echo "Pulling latest changes..."
git pull --ff-only

echo "Installing dependencies..."
npm install

echo "Done. Run ./run.sh to start the app."

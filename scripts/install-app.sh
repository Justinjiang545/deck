#!/bin/bash
# Build deck.app and install it to /Applications, replacing the running instance safely:
# quit → wait for the process to actually exit → swap bundle → relaunch.
# Terminals are unaffected (they live in the tmux server), only the window restarts.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run pack
APP=/Applications/deck.app
if pgrep -f "$APP/Contents/MacOS/deck" >/dev/null; then
  osascript -e 'quit app "deck"' >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do pgrep -f "$APP/Contents/MacOS/deck" >/dev/null || break; sleep 0.5; done
  if pgrep -f "$APP/Contents/MacOS/deck" >/dev/null; then
    echo "deck did not quit within 15s; killing" >&2
    pkill -f "$APP/Contents/MacOS/deck"; sleep 1
  fi
fi
rm -rf "$APP"
cp -R dist/mac-arm64/deck.app "$APP"
xattr -cr "$APP"
open -a "$APP"
echo "installed and launched $APP"

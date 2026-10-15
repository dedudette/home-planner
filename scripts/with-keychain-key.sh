#!/bin/sh
# Runs a command with ANTHROPIC_API_KEY taken from the macOS Keychain, so the key is never typed on a command line, written to a file,
# or left in shell history. The key is passed to that one command's environment and nowhere else; this script never prints it.
#
#   scripts/with-keychain-key.sh npm run dev
#
# One-time setup (you are prompted for the key, with no echo): see "Try it on your Mac" in the README.
set -eu

SERVICE="${COACH_KEYCHAIN_SERVICE:-cleanflow-anthropic-api-key}"
ACCOUNT="${COACH_KEYCHAIN_ACCOUNT:-${USER:-$(id -un)}}"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-keychain-key.sh <command> [args...]   (for example: npm run dev)" >&2
  exit 2
fi

if ! command -v security >/dev/null 2>&1; then
  echo "This helper reads the key from the macOS Keychain (the 'security' command), which was not found here." >&2
  echo "On another system, set ANTHROPIC_API_KEY in the server's environment by your own secure means." >&2
  exit 1
fi

if ! KEY="$(security find-generic-password -a "$ACCOUNT" -s "$SERVICE" -w 2>/dev/null)" || [ -z "$KEY" ]; then
  echo "No Keychain item named '$SERVICE' (account '$ACCOUNT') was found, or access to it was refused." >&2
  echo "Add it once with:  security add-generic-password -a \"$ACCOUNT\" -s \"$SERVICE\" -w" >&2
  echo "(it asks for the key; typing is hidden and nothing goes into your shell history)." >&2
  exit 1
fi

ANTHROPIC_API_KEY="$KEY"
export ANTHROPIC_API_KEY
unset KEY
exec "$@"

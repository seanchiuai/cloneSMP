#!/bin/bash
# Start all Mindcraft bots
# Requires NEBIUS_API_KEY to be set in environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MINDCRAFT_DIR="$ROOT_DIR/mindcraft"

if [ -z "$NEBIUS_API_KEY" ]; then
    echo "ERROR: NEBIUS_API_KEY environment variable not set."
    echo "Set it with: export NEBIUS_API_KEY=your_key_here"
    exit 1
fi

# Load nvm and use Node 20
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null || true

echo "Starting Mindcraft bots..."
cd "$MINDCRAFT_DIR"
node main.js

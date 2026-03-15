#!/bin/bash
# Start all Mindcraft bots
# Uses NEBIUS_API_KEY, or falls back to OPENAI_API_KEY.
# If env vars are missing, reads from mindcraft/keys.json.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MINDCRAFT_DIR="$ROOT_DIR/mindcraft"
KEYS_FILE="$MINDCRAFT_DIR/keys.json"

API_KEY="${NEBIUS_API_KEY:-$OPENAI_API_KEY}"
if [ -z "$API_KEY" ] && [ -f "$KEYS_FILE" ]; then
    API_KEY=$(node -e "const fs=require('fs');try{const k=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write((k.NEBIUS_API_KEY||k.OPENAI_API_KEY||'').trim());}catch{process.stdout.write('');}" "$KEYS_FILE")
fi

if [ -z "$API_KEY" ]; then
    echo "ERROR: missing API key."
    echo "Set NEBIUS_API_KEY or OPENAI_API_KEY (env), or add one in mindcraft/keys.json."
    exit 1
fi
export NEBIUS_API_KEY="$API_KEY"

# Load nvm and use Node 20
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null || true

echo "Starting Mindcraft bots..."
cd "$MINDCRAFT_DIR"
node main.js

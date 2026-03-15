#!/bin/bash
# Start everything: Paper server + Mindcraft bots + auto skin-setting
# Uses NEBIUS_API_KEY, or OPENAI_API_KEY fallback.
# If env vars are missing, reads from mindcraft/keys.json.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
KEYS_FILE="$ROOT_DIR/mindcraft/keys.json"
SERVER_PORT=55916
RCON_PORT="${RCON_PORT:-25575}"

API_KEY="${NEBIUS_API_KEY:-$OPENAI_API_KEY}"
if [ -z "$API_KEY" ] && [ -f "$KEYS_FILE" ]; then
    API_KEY=$(node -e "const fs=require('fs');try{const k=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write((k.NEBIUS_API_KEY||k.OPENAI_API_KEY||'').trim());}catch{process.stdout.write('');}" "$KEYS_FILE")
fi

if [ -z "$API_KEY" ]; then
    echo "ERROR: missing API key."
    echo "Set NEBIUS_API_KEY or OPENAI_API_KEY (env), or add one in mindcraft/keys.json."
    exit 1
fi

# Start Paper server in background (unless already running)
if lsof -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Paper server already running on port $SERVER_PORT."
    echo "If you recently installed/updated plugins, restart the server first so they load."
else
    echo "Starting Paper server..."
    osascript -e "tell app \"Terminal\" to do script \"cd '$ROOT_DIR/server' && ./start_server.sh\"" 2>/dev/null || \
        (cd "$ROOT_DIR/server" && ./start_server.sh &)

    echo "Waiting 20 seconds for server to start..."
    sleep 20
fi

# Start bots
echo "Starting Mindcraft bots..."
NEBIUS_API_KEY="$API_KEY" "$SCRIPT_DIR/start_bots.sh" &
BOTS_PID=$!

# Wait for bots to connect (give them 30s to spawn in)
echo "Waiting 30 seconds for bots to join..."
sleep 30

# Apply skins via RCON
echo "Applying hunter skins..."
if lsof -iTCP:"$RCON_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    node "$SCRIPT_DIR/set_skins.js" || echo "Skin setup failed — check server/plugins/README.md"
else
    echo "RCON port $RCON_PORT is not open; skipping auto skin setup."
    echo "Restart Paper after enabling RCON/plugin, then run: node scripts/set_skins.js"
fi

echo ""
echo "=== ClonesSMP running ==="
echo "Join Minecraft at: localhost:55916 (version 1.21.1, offline mode)"
echo ""

wait $BOTS_PID

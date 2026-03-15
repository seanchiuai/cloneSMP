#!/bin/bash
# Start everything: Paper server + Mindcraft bots + auto skin-setting
# Usage: GROQCLOUD_API_KEY=your_key ./start_all.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -z "$GROQCLOUD_API_KEY" ] && [ -z "$NEBIUS_API_KEY" ]; then
    echo "ERROR: Set GROQCLOUD_API_KEY or NEBIUS_API_KEY before running."
    echo "Usage: GROQCLOUD_API_KEY=your_key ./start_all.sh"
    exit 1
fi

# Start Paper server in background
echo "Starting Paper server..."
osascript -e "tell app \"Terminal\" to do script \"cd '$ROOT_DIR/server' && ./start_server.sh\"" 2>/dev/null || \
    (cd "$ROOT_DIR/server" && ./start_server.sh &)

echo "Waiting 20 seconds for server to start..."
sleep 20

# Start bots
echo "Starting Mindcraft bots..."
"$SCRIPT_DIR/start_bots.sh" &
BOTS_PID=$!

# Wait for bots to connect (give them 30s to spawn in)
echo "Waiting 30 seconds for bots to join..."
sleep 30

# Apply skins via RCON
echo "Applying hunter skins..."
node "$SCRIPT_DIR/set_skins.js" || echo "Skin setup failed — is SkinsRestorer installed? See server/plugins/README.md"

echo ""
echo "=== ClonesSMP running ==="
echo "Join Minecraft at: localhost:55916 (version 1.21.1, offline mode)"
echo ""

wait $BOTS_PID

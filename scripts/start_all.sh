#!/bin/bash
# Start everything: Paper server + Mindcraft bots
# Usage: NEBIUS_API_KEY=your_key ./start_all.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -z "$NEBIUS_API_KEY" ]; then
    echo "ERROR: NEBIUS_API_KEY environment variable not set."
    echo "Usage: NEBIUS_API_KEY=your_key ./start_all.sh"
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
NEBIUS_API_KEY="$NEBIUS_API_KEY" "$SCRIPT_DIR/start_bots.sh"

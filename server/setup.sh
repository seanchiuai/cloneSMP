#!/bin/bash
# Download Paper 1.21.1 server jar
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "paper-1.21.1-133.jar" ]; then
    echo "Paper jar already downloaded."
    exit 0
fi

echo "Downloading Paper 1.21.1 build 133..."
curl -L -o paper-1.21.1-133.jar \
    "https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/133/downloads/paper-1.21.1-133.jar"

echo "Done. Run ./start_server.sh to start the server."

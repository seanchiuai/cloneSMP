#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "paper-1.21.1-133.jar" ]; then
    echo "Paper jar not found. Run ./setup.sh first."
    exit 1
fi

java -Xms4G -Xmx4G -jar paper-1.21.1-133.jar --nogui

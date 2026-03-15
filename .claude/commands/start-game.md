---
description: Start all ClonesSMP game components (MC server, bots, orchestrator)
---

# Start ClonesSMP Game

Start all components needed to run a ClonesSMP Manhunt game. Follow each step in order.

## Step 1: Pre-flight checks

Run these checks in parallel:
- **Java**: `java -version` — need 21+
- **Node**: `node -v` — need 18+
- **API key**: confirm `orchestrator/.env` has `NEBIUS_API_KEY` set (or `mindcraft/keys.json` exists)
- **Mindcraft deps**: `mindcraft/node_modules` exists
- **Orchestrator deps**: `orchestrator/node_modules` exists
- **Server jar**: `server/paper-1.21.1-133.jar` exists

If any check fails, fix it before proceeding (install deps with `npm install`, etc).

## Step 2: Check what's already running

Check these ports in parallel:
- `lsof -iTCP:55916 -sTCP:LISTEN` — Minecraft server
- `lsof -iTCP:8080 -sTCP:LISTEN` — MindServer (Mindcraft)
- Check if orchestrator node process is running

Skip any component that's already running in subsequent steps.

## Step 3: Start Minecraft server

```bash
cd server && java -Xms4G -Xmx4G -jar paper-1.21.1-133.jar --nogui
```

Run in background. Then poll `lsof -iTCP:55916 -sTCP:LISTEN` every 2s until the server is listening (timeout after 60s).

## Step 4: Start Mindcraft bots

Source the API key from `orchestrator/.env`, then:

```bash
cd mindcraft && NEBIUS_API_KEY=<key> node main.js
```

Run in background. Then poll `lsof -iTCP:8080 -sTCP:LISTEN` every 2s until MindServer is up (timeout after 60s).

Wait for bot output to confirm all 4 bots have spawned (look for "spawned" messages for SamAltman, ElonMusk, DarioAmodei, JensenHuang).

## Step 5: Start orchestrator

```bash
cd orchestrator && npm start
```

Run in background. Check output to confirm it prints `[Orchestrator] Starting ClonesSMP Orchestrator...` and connects to MindServer.

The orchestrator will print "Waiting for hunters and a human player to join the game..." until a human connects via Minecraft client.

## Step 6: Report status and STOP

Tell the user:
- Which components started successfully
- Any errors or warnings observed (embedding model fallback warnings are non-critical)
- Connection info: `localhost:55916` (Minecraft 1.21.1, offline mode)
- MindServer UI: `http://localhost:8080`
- That the orchestrator is waiting for a human player to join

**IMPORTANT: You MUST stop here and wait for the user to respond.** Do NOT proceed to Step 7 automatically. Use AskUserQuestion to ask: "Ready to join! Connect to `localhost:55916` in Minecraft. Let me know when you're done playing and I'll analyze the logs." Do not continue until the user replies.

## Step 7: Post-game log analysis

After the user tells you they are done playing, read the logs from all three background tasks and report issues.

### What to check

**Minecraft server logs** (`server/logs/latest.log`):
- Crash dumps or stack traces
- Players kicked or timed out unexpectedly
- Plugin errors
- Tick lag warnings (e.g. "Can't keep up!")

**Mindcraft bot output** (background task output):
- Bot disconnections or crashes
- Failed LLM API calls (timeouts, rate limits, 4xx/5xx errors)
- Bots stuck in loops (same action repeated 5+ times with no progress)
- `Generated code threw error` — note which bot and what the error was
- Invalid command usage (e.g. out-of-range parameters like `searchForEntity` range errors)
- Bots unable to pathfind or getting stuck

**Orchestrator output** (background task output):
- WebSocket disconnection errors
- LLM API failures
- Parse errors (failed to extract directives from LLM response)
- Game state polling failures

### How to report

Present a summary with these sections:

1. **Game Result** — who won (hunters or runner), or if the game was abandoned
2. **Critical Errors** — anything that crashed, disconnected, or broke gameplay (needs fixing)
3. **Gameplay Issues** — bots behaving poorly, stuck in loops, ignoring directives, bad pathfinding (worth investigating)
4. **Non-critical Warnings** — expected/known warnings (no action needed)

For each critical/gameplay issue, include:
- Which component (server/bot name/orchestrator)
- The error message or log excerpt
- A suggested fix if obvious

If there are no issues, just say "Clean run — no issues detected."

## Known non-critical warnings

- `Error with embedding model, using word-overlap instead` — expected, no embedding model configured
- `keys.json not found. Defaulting to environment variables` — expected when using env var for API key
- `No task.` during bot initialization — normal startup behavior

$ARGUMENTS

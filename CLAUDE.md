# ClonesSMP

## Project Overview
Minecraft Manhunt: 4 AI celebrity hunters vs 1 human player. A single orchestrator LLM controls all 4 hunters — generating satirical dialogue and strategic directives. Each bot's individual LLM executes the directives as Minecraft commands. Nebius hackathon project.

## Tech Stack
- **Bot Framework:** Mindcraft (Node.js, Mineflayer) — cloned into `./mindcraft/`
- **Orchestrator:** Custom Node.js script in `./orchestrator/`
- **LLM Provider:** Nebius Token Factory (OpenAI-compatible) — `https://api.tokenfactory.nebius.com/v1/`
- **Model:** `meta-llama/Llama-3.3-70B-Instruct-fast` (orchestrator + all bot profiles via Nebius)
- **Minecraft Server:** Paper 1.21.1, local, offline mode, port 55916
- **Java:** 21+ (for server)
- **Node.js:** 18+ (for Mindcraft)

## Characters
4 AI hunters + 1 human runner. The orchestrator pretends to be all 4 characters simultaneously.

- **SamAltman** — optimistic visionary, Silicon Valley platitudes, AGI talk
- **ElonMusk** — chaotic, impulsive, first principles, memes, Mars references
- **DarioAmodei** — cautious, safety-conscious, alignment talk, dry humor
- **JensenHuang** — high energy, everything is "incredible", GPU/CUDA references, leather jackets

## Win Conditions
- **Hunters win:** kill the player
- **Player wins:** beat the Ender Dragon

## Project Structure
```
clonesSMP/
├── CLAUDE.md                    # This file
├── PLAN.md                      # Detailed project plan
├── orchestrator/                # Custom orchestrator script
│   ├── index.js                 # Main loop (poll → LLM → parse → send)
│   ├── game_state.js            # Polls bot/player state from MindServer
│   ├── llm.js                   # Calls Nebius API
│   ├── parser.js                # Parses LLM output → dialogue + directives
│   ├── prompt.txt               # Orchestrator system prompt
│   ├── package.json             # Node deps (openai, dotenv, socket.io-client)
│   └── .env                     # API keys — NEBIUS_API_KEY (gitignored)
├── mindcraft/                   # Cloned Mindcraft repo
│   ├── settings.js              # Modified for our setup
│   ├── keys.json                # API keys (gitignored, not needed — use NEBIUS_API_KEY env var)
│   ├── profiles/
│   │   ├── sam_altman.json
│   │   ├── elon_musk.json
│   │   ├── dario_amodei.json
│   │   └── jensen_huang.json
│   └── src/models/vllm.js       # Patched for Nebius API key
├── server/                      # Minecraft Paper server
│   ├── setup.sh
│   ├── server.properties
│   └── paper-1.21.1-133.jar
└── scripts/
    ├── start_server.sh
    ├── start_bots.sh
    ├── start_orchestrator.sh
    └── start_all.sh
```

## Key Implementation Details

### Orchestrator Architecture
- Polls game state every 10 seconds (player position, bot states, recent events)
- Calls orchestrator LLM with game state → outputs celebrity dialogue + per-bot directives
- Dialogue displayed in-game chat for entertainment
- Directives sent to each bot as self-prompter goals via MindServer WebSocket
- Bot goals persist until the next orchestrator cycle sends a new directive

### Nebius Integration
- Orchestrator uses `NEBIUS_API_KEY` env var with Nebius Token Factory's OpenAI-compatible API
- Each bot profile sets `"api": "vllm"` with `"url": "https://api.tokenfactory.nebius.com/v1/"` and model `meta-llama/Llama-3.3-70B-Instruct-fast`
- Orchestrator loads key from `orchestrator/.env` via dotenv; mindcraft bots read it from shell env

### Mindcraft Profile System
- Base profile: `survival` (from `profiles/defaults/survival.json`)
- Celebrity personality injected via `conversing` field override in profile JSON
- Self-prompter goal is the same for all bots: "You are [name]. You just woke up in Minecraft with other tech leaders. Build a modern house together. Be yourself."
- Mode overrides per character (e.g., Dario has `cowardice: true`, Elon has `self_preservation: false`)

### Bot Communication
- Bot-to-bot messaging goes through MindServer WebSocket, NOT Minecraft chat
- Only 1:1 conversations (no group chat)
- Self-prompter pauses during conversations
- Loop prevention: single active conversation per bot, timer-based batching

### Server Config
- `online-mode=false` (required for bot offline auth)
- `pvp=true`
- `spawn-protection=0`
- `allow-flight=true` (prevents kick on lag)
- `simulation-distance=8` (reduced for performance with 5 players)

## Commands

### Start server
```bash
cd server && java -Xms4G -Xmx4G -jar paper-1.21.1-133.jar --nogui
```

### Start bots
```bash
cd mindcraft && NEBIUS_API_KEY=your_key node main.js
```

### Start orchestrator
```bash
cd orchestrator && npm start   # loads NEBIUS_API_KEY from .env automatically
```

### Connect as player
Minecraft client → Multiplayer → Direct Connect → `localhost:55916`

## Important Notes
- Player username must NOT match any bot profile name
- Need 16GB+ RAM to run everything on one machine
- MindServer web UI runs on port 8080 for monitoring
- `allow_insecure_coding: true` in settings.js enables bots to write custom JS actions
- Bots may get stuck — restart via MindServer UI

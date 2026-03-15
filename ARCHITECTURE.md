# ClonesSMP — Architecture Document

## Overview

ClonesSMP is a hackathon project where 4 AI-controlled Minecraft bots — impersonating Sam Altman, Elon Musk, Dario Amodei, and Jensen Huang — collaborate (and potentially betray each other) to beat the game alongside 1 human player. Built on top of Mindcraft (Node.js/Mineflayer), powered by Nebius AI's OpenAI-compatible API.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST MACHINE                                 │
│                                                                     │
│  ┌──────────────────────┐       ┌─────────────────────────────────┐ │
│  │   Minecraft Server   │       │       Mindcraft (Node.js)       │ │
│  │   (Paper 1.21.4)     │       │                                 │ │
│  │                      │◄─────►│  ┌───────────┐ ┌───────────┐   │ │
│  │   Port: 25565        │  MC   │  │ Bot: Sam   │ │ Bot: Elon │   │ │
│  │                      │ Proto │  │ Altman     │ │ Musk      │   │ │
│  │  ┌────────────────┐  │       │  └─────┬─────┘ └─────┬─────┘   │ │
│  │  │ Human Player   │  │       │  ┌─────┴─────┐ ┌─────┴─────┐   │ │
│  │  │ (Minecraft     │  │       │  │ Bot: Dario│ │Bot: Jensen│   │ │
│  │  │  Client)       │  │       │  │ Amodei    │ │ Huang     │   │ │
│  │  └────────────────┘  │       │  └─────┬─────┘ └─────┬─────┘   │ │
│  └──────────────────────┘       │        │             │         │ │
│                                 │  ┌─────┴─────────────┴─────┐   │ │
│  ┌──────────────────────┐       │  │     MindServer           │   │ │
│  │  Browser (Web UI)    │◄─────►│  │     (WebSocket + HTTP)   │   │ │
│  │  localhost:8080      │  WS   │  │     Port: 8080           │   │ │
│  └──────────────────────┘       │  └─────────────────────────┘   │ │
│                                 └──────────┬──────────────────────┘ │
└────────────────────────────────────────────┼────────────────────────┘
                                             │ HTTPS
                                             ▼
                                ┌────────────────────────┐
                                │    Nebius AI API        │
                                │ api.studio.nebius.ai/v1 │
                                │                        │
                                │  Model: meta-llama/    │
                                │  Meta-Llama-3.1-70B    │
                                │  -Instruct             │
                                └────────────────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **Paper Server** | Hosts the Minecraft world. All 4 bots + 1 human connect here. Paper chosen over vanilla for performance and tick control. |
| **Mindcraft** | Single Node.js process managing all 4 bot agents. Each agent has its own Mineflayer bot instance, conversation manager, self-prompter, and action queue. |
| **MindServer** | Built into Mindcraft. WebSocket server + HTTP UI on port 8080. Lets you observe bot thoughts, send commands, and monitor state. |
| **Nebius AI** | OpenAI-compatible LLM endpoint. All 4 bots share the same API key but each sends its own celebrity system prompt. |
| **Human Player** | Joins via standard Minecraft client. Can chat with bots, trade, cooperate, or interfere. |

### Connection Details

- **Bots -> Server**: Mineflayer connects via Minecraft protocol to `127.0.0.1:25565`, offline auth (no Microsoft login needed).
- **Bots -> Nebius**: HTTPS POST to `https://api.studio.nebius.ai/v1/chat/completions`. Uses `gpt.js` model handler with custom `url` override.
- **Browser -> MindServer**: WebSocket on `localhost:8080` for real-time bot monitoring.

---

## 2. Directory / File Structure

Everything lives inside a cloned Mindcraft repo with our additions:

```
mindcraft/                          # Cloned from github.com/kolbytn/mindcraft
├── settings.js                     # MODIFIED — 4 profiles, server config
├── keys.json                       # CREATED — Nebius API key
│
├── profiles/
│   ├── defaults/
│   │   ├── _default.json           # STOCK — base prompts (do not edit)
│   │   └── survival.json           # STOCK — survival mode defaults
│   │
│   ├── sam_altman.json             # CREATED — Sam Altman bot profile
│   ├── elon_musk.json              # CREATED — Elon Musk bot profile
│   ├── dario_amodei.json           # CREATED — Dario Amodei bot profile
│   └── jensen_huang.json           # CREATED — Jensen Huang bot profile
│
├── src/
│   ├── agent/
│   │   ├── agent.js                # STOCK — core agent loop
│   │   ├── conversation.js         # STOCK — bot-to-bot chat handling
│   │   ├── self_prompter.js        # STOCK — autonomous goal loop
│   │   ├── modes.js                # STOCK — behavioral modes
│   │   └── ...
│   └── models/
│       ├── gpt.js                  # STOCK — OpenAI-compatible client (used for Nebius)
│       └── ...
│
├── launch.sh                       # CREATED — one-command startup script
└── server/                         # CREATED — Paper server directory
    ├── paper-1.21.4.jar
    ├── server.properties           # CREATED — server config
    ├── eula.txt
    └── ops.json
```

### Files We Create (6 total)

1. `profiles/sam_altman.json`
2. `profiles/elon_musk.json`
3. `profiles/dario_amodei.json`
4. `profiles/jensen_huang.json`
5. `keys.json`
6. `launch.sh`

### Files We Modify (1 total)

1. `settings.js`

No Mindcraft source code needs modification. The entire celebrity personality layer is achieved through profile JSON overrides.

---

## 3. Data Flow — Single Interaction Trace

Example: Elon Musk bot sees a zombie approaching.

```
Step 1: PERCEPTION
  Mineflayer event fires: entitySpawn(zombie) at distance 12 blocks
  └─► modes.js self_defense check triggers
  └─► Agent decides this needs LLM reasoning (non-trivial threat)

Step 2: CONTEXT ASSEMBLY (prompter.js)
  System prompt constructed by merging:
  ├── _default.json "conversing" template
  ├── survival.json mode overrides
  └── elon_musk.json "conversing" override  ◄── CELEBRITY PERSONALITY HERE

  Placeholder replacement:
  ├── $NAME → "ElonMusk"
  ├── $STATS → "Health: 18/20, Hunger: 16/20, Position: (142, 64, -87)..."
  ├── $INVENTORY → "[iron_sword x1, steak x12, cobblestone x43]"
  ├── $COMMAND_DOCS → Available commands (truncated to relevant_docs_count)
  ├── $MEMORY → "Found iron near coords 100,12,-50. Sam wants to find diamonds..."
  └── $SELF_PROMPT → "Beat Minecraft by killing the Ender Dragon. Gather resources..."

  Recent message history (max_messages: 15) appended as conversation turns.

Step 3: LLM CALL (gpt.js → Nebius)
  POST https://api.studio.nebius.ai/v1/chat/completions
  {
    "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
    "messages": [
      {"role": "system", "content": "<assembled system prompt>"},
      {"role": "user",   "content": "A zombie is approaching..."},
      ...conversation history...
    ]
  }

Step 4: LLM RESPONSE
  "A zombie? Please. I've dealt with harder problems trying to get
   Starship to orbit. !attack(\"zombie\")"

Step 5: EXECUTION (action_manager.js)
  ├── Chat text displayed in Minecraft: "A zombie? Please..."
  ├── !attack("zombie") parsed by command system
  └── Mineflayer pathfinds to zombie and attacks with equipped weapon

Step 6: MEMORY (if conversation long enough)
  prompter.promptMemSaving() compresses recent turns into $MEMORY
  └── Stored for next context assembly cycle
```

---

## 4. Multi-Bot Orchestration

### 4.1 All Bots Connect to Same Server

Mindcraft natively supports multiple profiles. Each entry in `settings.profiles[]` spawns an independent agent with its own:
- Mineflayer bot instance (separate connection to MC server)
- ConversationManager
- SelfPrompter
- ActionManager
- Message history

All 4 agents run in the same Node.js process, managed by MindServer.

### 4.2 Bot-to-Bot Conversation Flow

Mindcraft has a built-in bot-to-bot communication system via `conversation.js` and `mindserver_proxy.js`:

```
SamAltman wants to talk to ElonMusk:

1. Sam's LLM outputs: !startConversation("ElonMusk", "Hey Elon, let's find diamonds")
2. ConversationManager.startConversation() called
   └── Sam's self_prompter PAUSES (conversation takes priority)
3. Message routed through MindServer to Elon's ConversationManager
   └── Elon's self_prompter PAUSES
4. Elon's agent.handleMessage() processes the incoming message
   └── LLM generates response in Elon's voice
5. Response sent back to Sam via sendToBot()
6. Conversation continues until one bot calls !endConversation("ElonMusk")
   └── Both self_prompters RESUME
```

Key rules enforced by `conversation.js`:
- A bot can only be in ONE active conversation at a time
- If a third bot tries to start a conversation with a busy bot, it gets: "I'm talking to someone else, try again later."
- Conversation messages are tagged with `(FROM OTHER BOT)` prefix

### 4.3 Preventing Infinite Chat Loops

Multiple mechanisms already exist in Mindcraft:

| Mechanism | How It Works |
|-----------|--------------|
| **Explicit end command** | Any bot can call `!endConversation("name")` to terminate. The `conversing` prompt instructs bots to end conversations when done. |
| **Wait timeout** | If a bot waits >30s for a response (doubles each timeout), it sends a nudge. Eventually the conversation dies. |
| **Self-prompter priority** | When a conversation ends, the self-prompter resumes, pulling the bot back to its goal. Bots are incentivized to stop chatting and get back to work. |
| **Busy-busy suppression** | If both bots are executing commands, `_scheduleProcessInMessage()` suppresses responses unless the action is trivially interruptible (like following a player). |
| **No-command auto-stop** | If the self-prompter fires 3 times without the bot issuing a command, it stops — preventing aimless chatter loops. |
| **Celebrity prompt instruction** | Each profile's `conversing` prompt explicitly instructs: "Keep conversations short and goal-oriented. End conversations when you have a plan." |

### 4.4 Self-Prompter Drives "Beat the Game"

Each bot's profile sets a self-prompt goal that fires continuously when the bot is not in conversation:

```
Self-prompter message (injected every loop):
"You are self-prompting with the goal: 'Beat Minecraft by killing the Ender Dragon.
 Prioritize: 1) Get wood/stone tools 2) Find iron 3) Get diamonds 4) Find fortress
 5) Get blaze rods 6) Get ender pearls 7) Find stronghold 8) Kill dragon.
 Coordinate with other players when beneficial.'
 Your next response MUST contain a command. Respond:"
```

The self-prompter loop (`self_prompter.js`):
1. Sends the goal prompt to the LLM
2. LLM responds with an action command (e.g., `!collectBlocks("oak_log", 10)`)
3. Waits for action to complete (2s cooldown)
4. Loops back to step 1
5. Pauses automatically when another bot starts a conversation
6. Resumes 5 seconds after conversation ends

---

## 5. Celebrity Personality Layer

### 5.1 Where Injection Happens

The personality is injected **entirely through profile JSON files**. Mindcraft's prompter uses a 3-tier merge:

```
_default.json          ← Base template with $PLACEHOLDER variables
    ▼ overridden by
survival.json          ← Mode defaults (self_defense: true, etc.)
    ▼ overridden by
elon_musk.json         ← OUR FILE: custom name, model, conversing prompt, modes
```

The `conversing` field in the profile is the system prompt sent to the LLM on every interaction. By overriding it, we control the bot's entire personality while keeping all the functional placeholders ($STATS, $INVENTORY, $COMMAND_DOCS, etc.).

### 5.2 Profile Fields to Override

Each celebrity profile JSON overrides these fields:

```jsonc
{
    // REQUIRED
    "name": "ElonMusk",                    // In-game username (no spaces)

    "model": {                              // Route to Nebius
        "api": "openai",
        "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
        "url": "https://api.studio.nebius.ai/v1/"
    },

    // PERSONALITY — the core override
    "conversing": "You are ElonMusk, an AI Minecraft bot. You talk exactly like Elon Musk — blunt, memey, obsessed with engineering and efficiency. You occasionally reference Tesla, SpaceX, and Mars. You think you're the smartest player on the server. You might betray allies if it's more efficient. Be very brief. Use commands immediately when needed. ...[rest of functional instructions + all $PLACEHOLDERS]...",

    // OPTIONAL OVERRIDES
    "saving_memory": "...",                 // Can keep default
    "coding": "...",                        // Can keep default

    "modes": {                              // Per-personality behavior
        "cowardice": false,                 // Elon doesn't run
        "self_defense": true,
        "hunting": true
    },

    "cooldown": 3000                        // Response delay (ms)
}
```

### 5.3 Which Fields to Override Per Bot

| Field | Override? | Reason |
|-------|-----------|--------|
| `name` | YES | Sets in-game name and how other bots address them |
| `model` | YES | Points all bots to Nebius API with custom URL |
| `conversing` | YES | **Primary personality injection**. Must include all $PLACEHOLDER variables from the default or they won't be populated. |
| `saving_memory` | OPTIONAL | Could add "save memories in character" but default works fine |
| `coding` | NO | Code generation doesn't need personality; functional correctness matters more |
| `modes` | YES | Personality-driven behavior differences (see section 6) |
| `cooldown` | OPTIONAL | Can vary per bot for pacing |

### 5.4 The "conversing" Prompt — Template

Every celebrity's `conversing` field must include the functional scaffolding from `_default.json` plus the personality layer on top. Structure:

```
[PERSONALITY BLOCK — 2-4 sentences establishing voice and behavioral traits]
[FUNCTIONAL BLOCK — copied from _default.json, kept intact]
[GAME GOAL — "Your mission is to beat Minecraft by killing the Ender Dragon"]
[SOCIAL RULES — "Keep conversations short. Cooperate when useful. Betray when advantageous."]
[PLACEHOLDERS — $NAME, $MEMORY, $STATS, $INVENTORY, $COMMAND_DOCS, $EXAMPLES, etc.]
```

---

## 6. Configuration Decisions

### 6.1 Minecraft Version

**Version: 1.21.4**

- Latest stable version with full Mineflayer support
- Mindcraft's `"minecraft_version": "auto"` will auto-detect, but we pin it for reliability

### 6.2 Server Type

**Paper 1.21.4**

- Better TPS (ticks per second) than vanilla — critical with 5 players
- Anti-cheat can be disabled (important: bots move programmatically)
- Async chunk loading prevents lag spikes
- `server.properties` key settings:
  ```properties
  online-mode=false          # Required for offline auth
  difficulty=normal          # Not hard — bots struggle enough
  pvp=true                   # Allow betrayal mechanics
  spawn-protection=0         # Bots need to interact near spawn
  max-players=10             # Headroom
  view-distance=10           # Reduce for performance
  simulation-distance=6      # Reduce for performance
  ```

### 6.3 settings.js Values

```javascript
const settings = {
    "minecraft_version": "1.21.4",
    "host": "127.0.0.1",
    "port": 25565,
    "auth": "offline",

    "mindserver_port": 8080,
    "auto_open_ui": true,

    "base_profile": "survival",          // survival mode defaults for all bots
    "profiles": [
        "./profiles/sam_altman.json",
        "./profiles/elon_musk.json",
        "./profiles/dario_amodei.json",
        "./profiles/jensen_huang.json",
    ],

    "load_memory": false,                // fresh start each session
    "init_message": "Respond with hello world and your name and your goal",
    "only_chat_with": [],                // public chat — all bots hear everything

    "speak": false,                      // text-only MVP
    "chat_ingame": true,                 // show bot responses in MC chat
    "language": "en",
    "render_bot_view": false,            // save resources

    "allow_insecure_coding": false,      // safety
    "allow_vision": false,               // text-only MVP
    "blocked_actions": ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"],
    "code_timeout_mins": 3,              // prevent runaway code

    "max_messages": 15,                  // context window management
    "num_examples": 2,                   // few-shot examples
    "max_commands": 5,                   // prevent command spam per response
    "show_command_syntax": "full",
    "narrate_behavior": true,            // "Picking up item!" in chat
    "chat_bot_messages": true,           // bots see each other's public chat

    "log_all_prompts": true,             // hackathon debugging — see everything
}
```

### 6.4 keys.json

```json
{
    "OPENAI_API_KEY": "<your-nebius-api-key>"
}
```

The Nebius API key goes in `OPENAI_API_KEY` because we use the `"api": "openai"` handler with a custom URL. The `gpt.js` model handler reads this key and sends it to whatever `baseURL` is specified in the profile.

### 6.5 Modes Per Celebrity

Each bot has personality-appropriate behavioral modes:

| Mode | Sam Altman | Elon Musk | Dario Amodei | Jensen Huang |
|------|-----------|-----------|-------------|-------------|
| `self_preservation` | true | true | **true** | true |
| `unstuck` | true | true | true | true |
| `cowardice` | false | **false** | **true** | false |
| `self_defense` | true | **true** | false | **true** |
| `hunting` | true | **true** | false | **true** |
| `item_collecting` | true | true | true | true |
| `torch_placing` | true | true | true | true |
| `elbow_room` | true | false | true | false |
| `idle_staring` | true | true | true | true |
| `cheat` | false | false | false | false |

**Rationale:**
- **Sam Altman**: Balanced leader. Standard survival settings. Not cowardly, but not reckless.
- **Elon Musk**: Aggressive, no personal space boundaries, actively hunts and fights. Never runs.
- **Dario Amodei**: Safety-first. Cowardice ON (runs from danger). Self-defense and hunting OFF (avoids violence). The "safety researcher" who won't fight.
- **Jensen Huang**: Aggressive and social (no elbow room). Fights and hunts actively. Performance-oriented.

---

## 7. Celebrity Profile Designs

### 7.1 Sam Altman (`profiles/sam_altman.json`)

**Voice**: Corporate-optimistic, talks about "scaling" and "alignment," diplomatically vague, sees himself as the team leader. Uses phrases like "I think the right framing here is..." and "We should think about this from first principles."

**Behavior**: Tries to organize the group. Proposes plans. Delegates tasks. Might claim credit. Will suggest "pivoting strategy" when things go wrong.

**Self-prompt goal**: "Beat Minecraft. You are the natural leader. Organize the team, delegate tasks, and ensure steady progress toward the Ender Dragon. Prioritize resource gathering and team coordination."

### 7.2 Elon Musk (`profiles/elon_musk.json`)

**Voice**: Blunt, memey, references rockets/cars/Mars, overestimates his abilities, calls things "insane" or "based." Types in fragments. Occasionally says something genuinely clever.

**Behavior**: Goes solo, takes big risks, dies a lot but doesn't care. Might try to speedrun while others are still mining wood. Will build things nobody asked for.

**Self-prompt goal**: "Beat Minecraft as fast as possible. Move fast, take risks, speedrun. Don't wait for others unless absolutely necessary. Engineering solutions over brute force."

### 7.3 Dario Amodei (`profiles/dario_amodei.json`)

**Voice**: Thoughtful, measured, brings up safety concerns, says "I think we should be careful about..." a lot. References interpretability and alignment. Quietly competent.

**Behavior**: Risk-averse, thorough, gathers extra resources "just in case." Won't enter the Nether without full iron armor. Will question whether killing the dragon is ethical.

**Self-prompt goal**: "Beat Minecraft safely. Ensure you have adequate equipment and resources before taking risks. Coordinate with the team. Avoid unnecessary danger. Think carefully before entering the Nether."

### 7.4 Jensen Huang (`profiles/jensen_huang.json`)

**Voice**: Enthusiastic, says "the more you buy, the more you save" about everything. References CUDA, GPUs, and parallel processing. Loves leather jackets. Everything is "accelerated."

**Behavior**: Efficient and parallel — tries to do multiple things at once. Builds farms and automation. Trades aggressively. Sees everything as an optimization problem.

**Self-prompt goal**: "Beat Minecraft with maximum throughput. Optimize resource gathering, build systems that produce passively, and accelerate progress toward the Ender Dragon. Efficiency is everything."

---

## 8. Launch Procedure

### 8.1 launch.sh

```bash
#!/bin/bash
# ClonesSMP — one-command launch

# Start Paper server in background
echo "Starting Minecraft server..."
cd server && java -Xmx2G -Xms1G -jar paper-1.21.4.jar nogui &
MC_PID=$!

# Wait for server to be ready
echo "Waiting for server to start..."
sleep 15

# Start Mindcraft (all 4 bots connect automatically)
echo "Starting Mindcraft with 4 celebrity bots..."
cd .. && node main.js

# Cleanup on exit
kill $MC_PID 2>/dev/null
```

### 8.2 Startup Sequence

1. Paper server starts, loads world, opens port 25565
2. Mindcraft starts, reads `settings.js`, loads all 4 profiles
3. Each profile triggers:
   - Mineflayer bot connects to server as "SamAltman", "ElonMusk", etc.
   - Profile JSON merged with `_default.json` + `survival.json`
   - `init_message` sent: each bot introduces itself in character
   - Self-prompter starts with the "beat the game" goal
4. Human player joins via Minecraft client to `localhost:25565`
5. MindServer UI available at `http://localhost:8080`

---

## 9. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Bots get stuck in chat loops | Conversation timeout (30s), endConversation command in prompts, self-prompter resume after 5s |
| Nebius rate limits | `cooldown: 3000` per bot, `max_commands: 5` per response |
| Bots break character | Strong system prompt with personality + functional instructions. Memory summarization keeps character context. |
| Server lag with 5 players | Paper server, reduced view/simulation distance, `render_bot_view: false` |
| Bots die repeatedly | `self_preservation` mode on all bots. Dario has `cowardice: true`. |
| Token costs explode | `max_messages: 15` limits context. `relevant_docs_count: 5` limits docs. `num_examples: 2`. |
| All bots try same task | Different self-prompt goals create natural task diversity. Sam coordinates, Elon speedruns, Dario gathers, Jensen optimizes. |

---

## 10. Summary of What To Build

### Minimal viable steps (in order):

1. Clone Mindcraft repo
2. Set up Paper 1.21.4 server in `server/` subdirectory
3. Create `keys.json` with Nebius API key
4. Create 4 profile JSONs in `profiles/`
5. Modify `settings.js` to reference all 4 profiles
6. Write `launch.sh`
7. Start server, start Mindcraft, join as human player
8. Watch the chaos unfold

### No source code modifications required.

The entire project is achieved through configuration: 4 JSON profiles + 1 settings file + 1 API key file.

# ClonesSMP — Comprehensive Project Plan

> AI celebrity clones in Minecraft collaborating to build a modern house. Nebius hackathon project.

---

## 1. Overview

**Concept:** 4 AI-controlled Minecraft bots, each roleplaying as a tech celebrity (Sam Altman, Elon Musk, Dario Amodei, Jensen Huang), plus 1 human player. The bots collaborate (or clash) to build a modern house together. Each celebrity brings their own aesthetic vision and work style — driven by LLM reasoning filtered through their celebrity persona.

**Tech Stack:**
- **Minecraft Bot Framework:** [Mindcraft](https://github.com/mindcraft-bots/mindcraft) (Node.js, Mineflayer-based, ~4.9k stars)
- **LLM Provider:** Nebius Token Factory (OpenAI-compatible API)
- **Minecraft Server:** Paper 1.21.1 (local, offline mode)
- **Minecraft Version:** 1.21.1

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Local Machine (macOS)                  │
│                                                          │
│  ┌──────────────────┐      ┌─────────────────────────┐  │
│  │  Paper Server     │◄────►│  Minecraft Client       │  │
│  │  (Java 21)        │      │  (Human Player)          │  │
│  │  Port 55916       │      │  localhost:55916          │  │
│  └────────┬─────────┘      └─────────────────────────┘  │
│           │ Mineflayer protocol (x4)                      │
│  ┌────────▼─────────────────────────────────────────┐   │
│  │              Mindcraft (Node.js)                   │   │
│  │                                                    │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ │   │
│  │  │ Sam      │ │ Elon     │ │ Dario  │ │ Jensen │ │   │
│  │  │ Altman   │ │ Musk     │ │ Amodei │ │ Huang  │ │   │
│  │  └────┬─────┘ └────┬─────┘ └───┬────┘ └───┬────┘ │   │
│  │       │             │           │           │      │   │
│  │  ┌────▼─────────────▼───────────▼───────────▼────┐│   │
│  │  │           MindServer (WebSocket)               ││   │
│  │  │           Bot-to-bot messaging                 ││   │
│  │  │           Web UI on port 8080                  ││   │
│  │  └───────────────────┬───────────────────────────┘│   │
│  └──────────────────────┼────────────────────────────┘   │
│                         │                                 │
└─────────────────────────┼─────────────────────────────────┘
                          │ HTTPS API calls
              ┌───────────▼───────────────┐
              │   Nebius Token Factory     │
              │   api.tokenfactory.        │
              │   nebius.com/v1/           │
              │                            │
              │   Model: Llama-3.3-70B     │
              │   or DeepSeek-V3           │
              └────────────────────────────┘
```

### Data Flow (Single Bot Decision Cycle)

1. Bot perceives environment (nearby blocks, entities, inventory) via Mineflayer
2. Mindcraft's `prompter.js` assembles prompt: system prompt (celebrity persona) + environment state + conversation history + available commands
3. Prompt sent to Nebius API via OpenAI-compatible endpoint
4. LLM responds with text + command(s) (e.g., `!collectBlocks("oak_log", 5)`)
5. Mindcraft parses response, executes command via Mineflayer
6. Chat text appears in-game; other bots see it via MindServer proxy
7. Self-prompter re-triggers after cooldown → repeat

### Bot-to-Bot Communication Flow

- Uses MindServer WebSocket relay (NOT Minecraft chat when multiple agents exist)
- 1:1 conversations only (`!startConversation` / `!endConversation`)
- Bot can only be in one conversation at a time
- Self-prompter pauses during conversation, resumes 5s after

---

## 3. File Structure

```
clonesSMP/
├── PLAN.md                          # This file
├── mindcraft/                       # Cloned Mindcraft repo
│   ├── settings.js                  # Modified: port, profiles, auth
│   ├── keys.json                    # Nebius API key (from keys.example.json)
│   ├── profiles/
│   │   ├── sam_altman.json          # NEW: Sam profile
│   │   ├── elon_musk.json          # NEW: Elon profile
│   │   ├── dario_amodei.json       # NEW: Dario profile
│   │   └── jensen_huang.json       # NEW: Jensen profile
│   └── src/models/vllm.js          # PATCHED: add API key support
├── server/
│   ├── setup.sh                     # Server setup & launch script
│   ├── paper-1.21.1-133.jar        # Downloaded Paper server
│   ├── server.properties            # Configured for bots
│   └── eula.txt                     # Auto-accepted
└── scripts/
    ├── start_server.sh              # Launch Minecraft server
    ├── start_bots.sh                # Launch all Mindcraft bots
    └── start_all.sh                 # Launch everything
```

---

## 4. Celebrity Profiles

### 4.1 Sam Altman

**Personality:** Optimistic visionary, talks about AGI constantly, diplomatic but ambitious. Tends to coordinate and form alliances. Speaks in Silicon Valley platitudes.

**Personality:** Optimistic visionary, talks about AGI constantly, diplomatic but ambitious. Speaks in Silicon Valley platitudes. Believes in "iterating fast."

**Mode overrides:**
- `cowardice: false`
- `self_defense: true`
- `hunting: true`

**Self-prompter goal:** "You are Sam Altman. You just woke up in Minecraft with other tech leaders. You need to build a modern house together. Figure out what's going on, talk to the others, and start making progress. Be yourself."

### 4.2 Elon Musk

**Personality:** Chaotic, impulsive, meme-driven. Makes grand promises, pivots constantly. Alternates between genius-level strategy and absurd tangents. References Mars, X/Twitter, and "first principles thinking."

**Personality:** Chaotic, impulsive, meme-driven. Makes grand promises, pivots constantly. References Mars, X/Twitter, and "first principles thinking." Alternates between genius and absurdity.

**Mode overrides:**
- `cowardice: false` — fearless
- `self_defense: true`
- `hunting: true`
- `self_preservation: false` — yolo

**Self-prompter goal:** "You are Elon Musk. You just woke up in Minecraft with other tech leaders. You need to build a modern house together. Figure out what's going on, talk to the others, and start making progress. Be yourself."

### 4.3 Dario Amodei

**Personality:** Cautious, thoughtful, safety-conscious. Talks about alignment, responsible AI, and risk mitigation. Methodical planner. References safety research and careful reasoning. Dry humor.

**Personality:** Cautious, thoughtful, safety-conscious. Talks about alignment, responsible AI, and risk mitigation. Methodical. Dry humor. Suspicious of reckless behavior.

**Mode overrides:**
- `cowardice: true` — safety first
- `self_defense: true`
- `hunting: false` — avoids unnecessary violence
- `self_preservation: true`

**Self-prompter goal:** "You are Dario Amodei. You just woke up in Minecraft with other tech leaders. You need to build a modern house together. Figure out what's going on, talk to the others, and start making progress. Be yourself."

### 4.4 Jensen Huang

**Personality:** Enthusiastic, high-energy, everything is "incredible" and "accelerated." References GPUs, CUDA, parallel processing, and leather jackets. Optimistic about everything. Sees Minecraft as a simulation to optimize.

**Personality:** Enthusiastic, high-energy, everything is "incredible" and "accelerated." References GPUs, CUDA, parallel processing, and leather jackets. Optimistic about everything.

**Mode overrides:**
- `cowardice: false`
- `self_defense: true`
- `hunting: true`
- `self_preservation: true`

**Self-prompter goal:** "You are Jensen Huang. You just woke up in Minecraft with other tech leaders. You need to build a modern house together. Figure out what's going on, talk to the others, and start making progress. Be yourself."

---

## 5. Nebius API Configuration

### Endpoint
```
https://api.tokenfactory.nebius.com/v1/
```

### Recommended Models

| Use Case | Model | Cost (in/out per 1M tokens) | Notes |
|----------|-------|----------------------------|-------|
| **Primary (chat + code)** | `meta-llama/Llama-3.3-70B-Instruct-fast` | $0.25 / $0.75 | Best balance of speed, cost, intelligence |
| **Budget alternative** | `Qwen/Qwen3-30B-A3B-Instruct-2507` | $0.10 / $0.30 | MoE, very cheap |
| **Premium personality** | `deepseek-ai/DeepSeek-V3-0324` | $0.50 / $1.50 | Best roleplay quality |
| **Code-only model** | `Qwen/Qwen3-Coder-30B-A3B-Instruct` | $0.10 / $0.30 | If using separate code_model |

**Starting recommendation:** Use `meta-llama/Llama-3.3-70B-Instruct-fast` for everything. Switch to dual-model (DeepSeek for chat, Qwen-Coder for code) if personality feels flat.

### Rate Limits
- ~400K tokens/minute default — more than enough for 4 bots
- 4 bots × ~10 calls/min × ~3K tokens = ~120K tokens/min (well under limit)

### Integration (vllm.js patch required)

The Mindcraft `vllm.js` adapter hardcodes `apiKey = ""`. We must patch it:

```javascript
// In src/models/vllm.js constructor
vllm_config.apiKey = process.env.NEBIUS_API_KEY || "";
```

### Profile model configuration

```json
{
  "model": {
    "api": "vllm",
    "model": "meta-llama/Llama-3.3-70B-Instruct-fast",
    "url": "https://api.tokenfactory.nebius.com/v1/"
  }
}
```

### keys.json
```json
{
  "OPENAI_API_KEY": ""
}
```
(API key passed via `NEBIUS_API_KEY` env var instead, to avoid conflicts.)

---

## 6. Minecraft Server Configuration

### Server: Paper 1.21.1 (Build 133)
- Download: `https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/133/downloads/paper-1.21.1-133.jar`
- Java 21 required (`brew install openjdk@21`)
- Memory: `-Xms4G -Xmx4G`

### server.properties
```properties
online-mode=false          # Required for bot offline auth
server-port=55916          # Mindcraft default
gamemode=survival
difficulty=normal
pvp=true                   # Bots may fight
spawn-protection=0         # Bots can interact near spawn
allow-flight=true          # Prevents kick on lag
max-players=10
view-distance=10
simulation-distance=8      # Reduced for performance
white-list=false
enable-query=false
enable-rcon=false
```

### settings.js (Mindcraft)
```javascript
{
  minecraft_version: "1.21.1",
  host: "127.0.0.1",
  port: 55916,
  auth: "offline",
  mindserver_port: 8080,
  base_profile: "survival",
  profiles: [
    "./profiles/sam_altman.json",
    "./profiles/elon_musk.json",
    "./profiles/dario_amodei.json",
    "./profiles/jensen_huang.json"
  ],
  allow_insecure_coding: true,   // Needed for complex actions
  load_memory: true,              // Persist learnings across restarts
  chat_bot_messages: true,        // Bots see each other's messages
  narrate_behavior: true,         // Bots announce what they're doing
  max_messages: 15,
  cooldown: 3000
}
```

---

## 7. Risk Assessment & Mitigations

### Critical Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Bots get stuck in loops** — 19.3% of all LLM agent failures | VERY HIGH | Add phase-based goals in system prompt. Monitor via MindServer UI. Restart stuck bots. |
| **Building coordination is hard** — bots may build over each other or ignore the plan | HIGH | Give each bot a specific role (resource gatherer, foundation, walls, interior). Designate a build area. |
| **Pathfinding hangs** — documented Mineflayer bugs | HIGH | Accept occasional stuck states. Manual restart via MindServer. |
| **Boring demo** — Minecraft progression is slow | HIGH | Pre-play the world before demo. Start from interesting point. Build chat overlay to showcase personality. |

### Moderate Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Character breaking under cognitive load** | MEDIUM | Front-load personality in every prompt. Use distinctive catchphrases. Use a model good at roleplay (DeepSeek-V3). |
| **PvP death spirals** | MEDIUM | Can disable PvP in server.properties if needed. Or set `self_defense: false` on peaceful bots. |
| **API latency at hackathon** | MEDIUM | Use `-fast` model variants on Nebius. Have local Ollama as backup. |
| **Machine resource pressure** | MEDIUM | Need 16GB+ RAM. Close all other apps. Reduce view-distance if needed. |
| **No group chat** — only 1:1 conversations | MEDIUM | Accept this limitation. Bots can have sequential 1:1 chats. |

### Low Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Token costs** | LOW | Nebius pricing is cheap. ~$1-5 for entire hackathon with 70B model. |
| **Setup failures** | LOW | Pre-build everything before hackathon. Lock dependency versions. |

---

## 8. Fallback Plans (Ranked)

### Fallback A: "Partial House" (Most likely outcome)
The house is incomplete but clearly taking shape — foundation, some walls, a few features. The demo focuses on the celebrity interactions and collaboration dynamics during building. Still impressive.

### Fallback B: "Celebrity Minecraft Talk Show"
If building is too buggy, lean into conversation. Bots stand in a pre-built area and debate architecture, AI ethics, tech drama — all in character. The game is backdrop for the comedy.

### Fallback C: "One Bot + Human"
If multi-bot is unstable, run ONE bot (most entertaining personality) with the human player building together. 4x more stable.

### Fallback D: "Highlight Reel"
Record best moments during testing. Show reel + brief live demo. Guarantees impressive content.

---

## 9. Implementation Steps

### Phase 1: Foundation (2-3 hours)
1. [ ] Install Java 21, Node.js 18+
2. [ ] Download and configure Paper server
3. [ ] Clone Mindcraft, `npm install`
4. [ ] Set up Nebius API key
5. [ ] Patch `vllm.js` for Nebius API key support
6. [ ] Configure `settings.js` and `keys.json`
7. [ ] Test: single default bot connects and responds

### Phase 2: Celebrity Bots (2-3 hours)
8. [ ] Write Sam Altman profile + system prompt
9. [ ] Write Elon Musk profile + system prompt
10. [ ] Write Dario Amodei profile + system prompt
11. [ ] Write Jensen Huang profile + system prompt
12. [ ] Test: each bot individually — verify personality comes through
13. [ ] Test: all 4 bots simultaneously — verify they can coexist

### Phase 3: Multi-Agent Tuning (2-3 hours)
14. [ ] Test bot-to-bot conversations — verify no infinite loops
15. [ ] Tune self-prompter goals for interesting emergent behavior
16. [ ] Tune cooldowns and mode settings per personality
17. [ ] Test with human player in the world
18. [ ] Identify and fix stuck states

### Phase 4: Demo Prep (1-2 hours)
19. [ ] Pre-play the world to establish interesting starting conditions
20. [ ] Set up MindServer web UI for monitoring
21. [ ] Optional: build a chat overlay / dashboard for demo
22. [ ] Record backup footage of best moments
23. [ ] Prepare 3-minute demo script

**Total estimated time: 7-11 hours** (with buffer for debugging)

---

## 10. Demo Strategy

### What to show (3-5 min demo)
1. **Open with the MindServer web UI** showing all 4 bots active
2. **Highlight a conversation** where celebrities argue about house design (e.g., Elon wants a launchpad, Dario wants better lighting for safety)
3. **Show building in progress** — bots gathering resources, placing blocks, coordinating
4. **Show a conflict** — Elon builds something wild, Dario objects, Sam mediates
5. **Human player joins** and interacts with the bots

### What makes this impressive to judges
- Multi-agent emergent behavior (not scripted)
- Celebrity personas that are funny and recognizable
- Real-time LLM decision-making in a collaborative building task
- Visual result — an actual house being built
- The "what will they do next?" factor

---

## 11. Open Questions

1. **Which Nebius model to use?** Need to test Llama-3.3-70B vs DeepSeek-V3 for personality quality.
2. **How destructive should Elon be?** Should he be able to tear down others' work, or just add chaotic additions?
3. **Should we pre-build anything in the world?** Flatten a build area? Pre-stock resource chests?
4. **Do we want TTS?** Mindcraft supports it — bots could speak aloud. Cool for demo but adds complexity.
5. **Hackathon submission format?** What do judges expect — live demo, video, GitHub repo?
6. **Blueprint system?** Should we give bots a reference blueprint, or let them freestyle the house design?

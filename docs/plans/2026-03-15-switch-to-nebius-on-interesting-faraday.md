# Switch to Nebius Token Factory on interesting-faraday Branch

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge the `orchestrator/` directory from `main` into the `interesting-faraday` branch and update all LLM integrations to use Nebius Token Factory instead of Groq.

**Architecture:** The `interesting-faraday` branch already has the updated bot profiles using `"api": "vllm"` pointing at Nebius, and `vllm.js` is already patched to read `NEBIUS_API_KEY`. The only missing piece is the `orchestrator/` directory (added on `main` after this branch diverged), which currently uses Groq — it needs to be brought over and updated to use the Nebius endpoint.

**Tech Stack:** Node.js, Nebius Token Factory (`https://api.tokenfactory.nebius.com/v1/`), OpenAI SDK (OpenAI-compatible), model `meta-llama/Llama-3.3-70B-Instruct-fast`

---

### Task 1: Switch to interesting-faraday branch

**Files:** none (git operation only)

**Step 1: Check current branch**
```bash
git branch
```
Expected: `* main`

**Step 2: Fetch latest remote state**
```bash
git fetch origin
```

**Step 3: Switch to interesting-faraday**
```bash
git checkout -b interesting-faraday origin/claude/interesting-faraday
```
Expected: `Switched to a new branch 'interesting-faraday'`

**Step 4: Verify branch and root files**
```bash
git branch && ls
```
Expected output includes: `ARCHITECTURE.md  PLAN.md  mindcraft  scripts  server  skins`
Note: `orchestrator/` should NOT be present yet — that's expected.

**Step 5: Verify bot profiles already use Nebius**
```bash
node -e "const p = JSON.parse(require('fs').readFileSync('mindcraft/profiles/sam_altman.json')); console.log(JSON.stringify(p.model, null, 2))"
```
Expected:
```json
{
  "api": "vllm",
  "model": "meta-llama/Llama-3.3-70B-Instruct-fast",
  "url": "https://api.tokenfactory.nebius.com/v1/"
}
```

---

### Task 2: Bring orchestrator/ from main

The orchestrator directory was added to `main` after `interesting-faraday` branched. We use `git checkout` to copy it in without merging unrelated commits.

**Files:**
- Create: `orchestrator/` (entire directory from main)

**Step 1: Cherry-pick orchestrator files from main**
```bash
git checkout main -- orchestrator/
```
Expected: no output (silently stages the directory)

**Step 2: Verify orchestrator files are present and staged**
```bash
git status && ls orchestrator/
```
Expected files: `index.js  game_state.js  llm.js  parser.js  prompt.txt  package.json`

**Step 3: Verify orchestrator currently references Groq (confirm what we're about to fix)**
```bash
grep -n "groq\|GROQ\|Groq" orchestrator/llm.js
```
Expected: lines referencing `GROQCLOUD_API_KEY` and `api.groq.com`

**Step 4: Do NOT commit yet** — changes to orchestrator/llm.js in the next task must be in the same commit.

---

### Task 3: Update orchestrator to use Nebius Token Factory

**Files:**
- Modify: `orchestrator/llm.js`

**Step 1: Read the current file to understand its structure**
```bash
cat orchestrator/llm.js
```

**Step 2: Update the OpenAI client config in orchestrator/llm.js**

Change:
```js
const client = new OpenAI({
    apiKey: process.env.GROQCLOUD_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = process.env.ORCHESTRATOR_MODEL || 'llama-3.3-70b-versatile';
```

To:
```js
const client = new OpenAI({
    apiKey: process.env.NEBIUS_API_KEY,
    baseURL: 'https://api.tokenfactory.nebius.com/v1/',
});

const MODEL = process.env.ORCHESTRATOR_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-fast';
```

**Step 3: Update the error log message to say Nebius instead of Groq**

Change:
```js
console.error('[LLM] Error calling Groq API:', err.message);
```
To:
```js
console.error('[LLM] Error calling Nebius API:', err.message);
```

**Step 4: Verify the changes look right**
```bash
grep -n "NEBIUS\|tokenfactory\|Nebius\|meta-llama" orchestrator/llm.js
```
Expected: 3 matches (apiKey, baseURL, error log, MODEL default)

**Step 5: Commit both the orchestrator directory and the Nebius update together**
```bash
git add orchestrator/
git commit -m "feat: add orchestrator from main, switch to Nebius Token Factory"
```

---

### Task 4: Update CLAUDE.md to reflect Nebius

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Check current CLAUDE.md tech stack section**
```bash
grep -A 5 "## Tech Stack" CLAUDE.md
```

**Step 2: Update LLM Provider line** — change from Groq references to Nebius:
- `LLM Provider` line → `Nebius Token Factory (OpenAI-compatible) — https://api.tokenfactory.nebius.com/v1/`
- `Model` line → `meta-llama/Llama-3.3-70B-Instruct-fast` (orchestrator + all bot profiles via Nebius)

**Step 3: Update Groq Integration section → Nebius Integration**

Change the "Groq Integration" subsection under Key Implementation Details to:
```
### Nebius Integration
- Orchestrator uses `NEBIUS_API_KEY` env var with Nebius Token Factory's OpenAI-compatible API
- Each bot profile sets `"api": "vllm"` with `"url": "https://api.tokenfactory.nebius.com/v1/"` and model `meta-llama/Llama-3.3-70B-Instruct-fast`
- API key passed via env var, NOT in keys.json, to avoid conflicts
```

**Step 4: Update Commands section** — ensure start commands reference `NEBIUS_API_KEY`:
```bash
cd mindcraft && NEBIUS_API_KEY=your_key node main.js
cd orchestrator && NEBIUS_API_KEY=your_key node index.js
```

**Step 5: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Nebius Token Factory on interesting-faraday"
```

---

### Task 5: Smoke-test the integration (dry run)

No server needed — just verify the API key and model resolve correctly.

**Step 1: Install orchestrator dependencies**
```bash
cd orchestrator && npm install && cd ..
```

**Step 2: Run a minimal API test (replace `YOUR_KEY` with real key)**
```bash
NEBIUS_API_KEY=YOUR_KEY node -e "
import('openai').then(({ default: OpenAI }) => {
  const client = new OpenAI({
    apiKey: process.env.NEBIUS_API_KEY,
    baseURL: 'https://api.tokenfactory.nebius.com/v1/',
  });
  client.chat.completions.create({
    model: 'meta-llama/Llama-3.3-70B-Instruct-fast',
    messages: [{ role: 'user', content: 'Say: Nebius online.' }],
    max_tokens: 20,
  }).then(r => console.log('OK:', r.choices[0].message.content)).catch(e => console.error('FAIL:', e.message));
});
"
```
Expected: `OK: Nebius online.` (or similar short response)

**Step 3: Verify bot profile vllm adapter reads key correctly**
```bash
grep -n "NEBIUS_API_KEY" mindcraft/src/models/vllm.js
```
Expected: at least one match confirming the patch is in place.

---

## Summary

| Step | What changes |
|------|-------------|
| Task 1 | Switch to `interesting-faraday` branch |
| Task 2 | Copy `orchestrator/` from `main` |
| Task 3 | Swap orchestrator from Groq → Nebius (`NEBIUS_API_KEY`, `tokenfactory.nebius.com`) |
| Task 4 | Update CLAUDE.md |
| Task 5 | Smoke-test API connectivity |

After completion, run the full stack with:
```bash
# Terminal 1
cd server && java -Xms4G -Xmx4G -jar paper-1.21.1-133.jar --nogui

# Terminal 2
cd mindcraft && NEBIUS_API_KEY=your_key node main.js

# Terminal 3
cd orchestrator && NEBIUS_API_KEY=your_key node index.js
```

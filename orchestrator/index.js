import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { GameStateManager } from './game_state.js';
import { callOrchestrator } from './llm.js';
import { parseOrchestratorResponse, getFallbackDirectives, getDesperationDirectives } from './parser.js';

const ORCHESTRATOR_INTERVAL_MS = parseInt(process.env.ORCHESTRATOR_INTERVAL_MS || '10000');
const MINDSERVER_PORT = parseInt(process.env.MINDSERVER_PORT || '8080');

async function main() {
    console.log('[Orchestrator] Starting ClonesSMP Orchestrator...');
    console.log(`[Orchestrator] Cycle interval: ${ORCHESTRATOR_INTERVAL_MS}ms`);
    console.log(`[Orchestrator] MindServer port: ${MINDSERVER_PORT}`);
    console.log(`[Orchestrator] Hunt duration: 3 minutes`);

    if (!process.env.NEBIUS_API_KEY) {
        console.error('[Orchestrator] ERROR: NEBIUS_API_KEY environment variable is not set!');
        process.exit(1);
    }

    const gameState = new GameStateManager(MINDSERVER_PORT);

    // Connect to MindServer
    try {
        await gameState.connect();
    } catch (err) {
        console.error('[Orchestrator] Failed to connect to MindServer:', err.message);
        console.error('[Orchestrator] Make sure Mindcraft is running first (npm start in mindcraft/)');
        process.exit(1);
    }

    // Wait for agents to come online
    console.log('[Orchestrator] Waiting for hunters to join the game...');
    await waitForAgents(gameState);
    console.log('[Orchestrator] All hunters are online. Starting hunt in 5 seconds...');
    await sleep(5000);

    // Start the hunt timer
    gameState.startHunt();
    console.log('[Orchestrator] HUNT STARTED! 3 minutes on the clock!');

    // Main orchestration loop
    let cycleCount = 0;
    while (true) {
        cycleCount++;
        const remaining = gameState.getRemainingSeconds();
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        console.log(`\n[Orchestrator] === Cycle ${cycleCount} | ${mins}:${secs.toString().padStart(2, '0')} remaining ===`);

        if (gameState.isHuntOver()) {
            console.log('[Orchestrator] TIME IS UP! The player survived!');
            break;
        }

        try {
            await runCycle(gameState);
        } catch (err) {
            console.error('[Orchestrator] Cycle error:', err.message);
        }

        await sleep(ORCHESTRATOR_INTERVAL_MS);
    }

    console.log('[Orchestrator] Hunt complete. Shutting down.');
    process.exit(0);
}

async function runCycle(gameState) {
    const agentNames = gameState.getAgentNames();

    // DESPERATION OVERRIDE: last 30 seconds — skip LLM, hardcode rush
    if (gameState.isDesperationPhase()) {
        console.log('[Orchestrator] DESPERATION MODE — All hunters rush!');
        const desperationDirs = getDesperationDirectives(agentNames, gameState.playerPosition, gameState.playerName);
        sendDirectives(gameState, desperationDirs);

        // Save to history
        gameState.addToHistory('DESPERATION MODE', desperationDirs);
        return;
    }

    // 1. Build game state string
    const gameStateString = gameState.buildGameStateString();
    console.log('[Orchestrator] Game state:\n' + gameStateString);

    // 2. Call LLM with time info and history
    console.log('[Orchestrator] Calling Nebius LLM...');
    const timeInfo = gameState.getTimeInfo();
    const historyBlock = gameState.getHistoryBlock();
    const llmResponse = await callOrchestrator(gameStateString, timeInfo, historyBlock);

    if (!llmResponse) {
        console.warn('[Orchestrator] LLM returned empty response, using fallback directives');
        const fallbacks = getFallbackDirectives(agentNames, gameState.playerPosition, gameState.playerName);
        sendDirectives(gameState, fallbacks);
        gameState.addToHistory(gameStateString, fallbacks);
        return;
    }

    console.log('[Orchestrator] LLM Response:\n' + llmResponse);

    // 3. Parse response
    const parsed = parseOrchestratorResponse(llmResponse);

    // 4. Send directives FIRST
    let directives = parsed.directives;

    // Validate we got directives for all agents
    const missingDirectives = agentNames.filter(name => !directives[name]);
    if (missingDirectives.length > 0) {
        console.warn(`[Orchestrator] Missing directives for: ${missingDirectives.join(', ')}. Using fallbacks.`);
        const fallbacks = getFallbackDirectives(missingDirectives, gameState.playerPosition, gameState.playerName);
        directives = { ...fallbacks, ...directives };
    }

    sendDirectives(gameState, directives);

    // Save to history
    gameState.addToHistory(gameStateString, directives);

    // 5. Send dialogue AFTER directives with a delay
    await sleep(3000);
    if (parsed.dialogue.length > 0) {
        console.log('[Orchestrator] Broadcasting dialogue...');
        for (const { name, line } of parsed.dialogue) {
            gameState.sendDialogueLine(name, line);
            await sleep(500);
        }
    }
}

function sendDirectives(gameState, directives) {
    for (const [agentName, directive] of Object.entries(directives)) {
        const fullDirective = `!newAction("${directive.replace(/"/g, "'")}")`;
        console.log(`[Orchestrator] -> ${agentName}: ${fullDirective}`);
        gameState.sendDirective(agentName, fullDirective);
    }
}

async function waitForAgents(gameState, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (gameState.isReady()) return;
        await sleep(2000);
        process.stdout.write('.');
    }
    console.warn('\n[Orchestrator] Timeout waiting for agents — proceeding anyway');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
    console.error('[Orchestrator] Fatal error:', err);
    process.exit(1);
});

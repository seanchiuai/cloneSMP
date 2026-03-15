import { GameStateManager } from './game_state.js';
import { callOrchestrator } from './llm.js';
import { parseOrchestratorResponse, getFallbackDirectives } from './parser.js';

const ORCHESTRATOR_INTERVAL_MS = parseInt(process.env.ORCHESTRATOR_INTERVAL_MS || '10000');
const MINDSERVER_PORT = parseInt(process.env.MINDSERVER_PORT || '8080');

async function main() {
    console.log('[Orchestrator] Starting ClonesSMP Orchestrator...');
    console.log(`[Orchestrator] Cycle interval: ${ORCHESTRATOR_INTERVAL_MS}ms`);
    console.log(`[Orchestrator] MindServer port: ${MINDSERVER_PORT}`);

    if (!process.env.GROQCLOUD_API_KEY) {
        console.error('[Orchestrator] ERROR: GROQCLOUD_API_KEY environment variable is not set!');
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
    console.log('[Orchestrator] All hunters are online. Starting hunt coordination!');

    // Main orchestration loop
    let cycleCount = 0;
    while (true) {
        cycleCount++;
        console.log(`\n[Orchestrator] === Cycle ${cycleCount} ===`);

        try {
            await runCycle(gameState);
        } catch (err) {
            console.error('[Orchestrator] Cycle error:', err.message);
        }

        await sleep(ORCHESTRATOR_INTERVAL_MS);
    }
}

async function runCycle(gameState) {
    // 1. Build game state string
    const gameStateString = gameState.buildGameStateString();
    console.log('[Orchestrator] Game state:\n' + gameStateString);

    // 2. Call LLM
    console.log('[Orchestrator] Calling Nebius LLM...');
    const llmResponse = await callOrchestrator(gameStateString);

    if (!llmResponse) {
        console.warn('[Orchestrator] LLM returned empty response, using fallback directives');
        const fallbacks = getFallbackDirectives(gameState.getAgentNames());
        sendDirectives(gameState, fallbacks);
        return;
    }

    console.log('[Orchestrator] LLM Response:\n' + llmResponse);

    // 3. Parse response
    const parsed = parseOrchestratorResponse(llmResponse);

    // 4. Display dialogue in game chat
    if (parsed.dialogue.length > 0) {
        console.log('[Orchestrator] Broadcasting dialogue...');
        for (const { name, line } of parsed.dialogue) {
            // Send each dialogue line to the corresponding agent to say in chat
            gameState.sendDirective(name, `Say this in chat exactly (use !chat): "${line}"`);
            await sleep(500); // stagger the messages for readability
        }
    } else {
        console.warn('[Orchestrator] No dialogue parsed from LLM response');
    }

    // 5. Send directives
    const agentNames = gameState.getAgentNames();
    let directives = parsed.directives;

    // Validate we got directives for all agents
    const missingDirectives = agentNames.filter(name => !directives[name]);
    if (missingDirectives.length > 0) {
        console.warn(`[Orchestrator] Missing directives for: ${missingDirectives.join(', ')}. Using fallbacks.`);
        const fallbacks = getFallbackDirectives(missingDirectives);
        directives = { ...fallbacks, ...directives };
    }

    sendDirectives(gameState, directives);
}

function sendDirectives(gameState, directives) {
    for (const [agentName, directive] of Object.entries(directives)) {
        const fullDirective = `[ORCHESTRATOR DIRECTIVE] ${directive}. Execute this now. Use !goal or !newAction to complete the task.`;
        console.log(`[Orchestrator] -> ${agentName}: ${directive}`);
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

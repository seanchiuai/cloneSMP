import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { GameStateManager } from './game_state.js';
import { callOrchestrator } from './llm.js';
import { parseOrchestratorResponse, getFallbackDirectives, getDesperationDirectives } from './parser.js';

const ORCHESTRATOR_INTERVAL_MS = parseInt(process.env.ORCHESTRATOR_INTERVAL_MS || '5000');
const MINDSERVER_PORT = parseInt(process.env.MINDSERVER_PORT || '8080');

async function main() {
    console.log('[Orchestrator] Starting ClonesSMP Orchestrator...');
    console.log(`[Orchestrator] Cycle interval: ${ORCHESTRATOR_INTERVAL_MS}ms`);
    console.log(`[Orchestrator] MindServer port: ${MINDSERVER_PORT}`);
    console.log(`[Orchestrator] Hunt duration: 2 minutes (30s grace period before start)`);

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

    // Wait for agents AND a human player to come online
    console.log('[Orchestrator] Waiting for hunters and a human player to join the game...');
    await waitForAgents(gameState);
    console.log(`[Orchestrator] All hunters are online and player "${gameState.playerName}" detected. Chase begins in 30 seconds...`);
    await sleep(30000);

    // Initialize HUD before hunt starts
    await gameState.initHud();

    // Start the hunt timer
    gameState.startHunt();
    console.log('[Orchestrator] HUNT STARTED! 2 minutes on the clock!');

    // Auto-op hunters via RCON so they can use /effect commands
    console.log('[Orchestrator] Opping hunters via RCON...');
    await gameState.opHunters();

    // Apply glowing effect so players can always see the AI hunters
    console.log('[Orchestrator] Applying glow effect to all hunters...');
    await gameState.applyGlowToHunters();

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

        // Refresh glow effect every ~60 seconds (every 6th cycle)
        if (cycleCount % 6 === 0) {
            await gameState.applyGlowToHunters();
        }

        // Refresh player position via RCON each cycle (reliable, no proximity needed)
        if (gameState.playerName) {
            const pos = await gameState.getPlayerPositionViaRcon(gameState.playerName);
            if (pos) gameState.playerPosition = pos;
        }

        // Update in-game HUD (bossbar timer + scoreboard)
        await gameState.updateHud();

        try {
            await runCycle(gameState);
        } catch (err) {
            console.error('[Orchestrator] Cycle error:', err.message);
        }

        await sleep(ORCHESTRATOR_INTERVAL_MS);
    }

    // Clean up HUD
    await gameState.cleanupHud();

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
    const playerName = gameState.playerName;
    for (const [agentName, directive] of Object.entries(directives)) {
        // Find this hunter's distance to the player
        const state = gameState.agentStates[agentName];
        let dist = Infinity;
        if (state?.gameplay?.position && gameState.playerPosition) {
            const pos = state.gameplay.position;
            const pp = gameState.playerPosition;
            dist = Math.sqrt((pos.x - pp.x) ** 2 + (pos.z - pp.z) ** 2);
        }

        // Always chase or attack — maximum aggression
        let command;
        if (playerName && dist < 16) {
            // Within striking range — attack relentlessly
            command = `!attackPlayer("${playerName}")`;
        } else if (playerName) {
            // Far away — sprint to the player, get close
            command = `!goToPlayer("${playerName}", 2)`;
        } else if (gameState.playerPosition) {
            // No player name but have coords — rush to last known position
            const pp = gameState.playerPosition;
            command = `!goToCoordinates(${pp.x}, ${pp.y}, ${pp.z}, 2)`;
        } else {
            // No info — search aggressively
            command = `!newAction("Sprint in a random direction searching for the player. Look around constantly. Attack any player on sight.")`;
        }

        console.log(`[Orchestrator] -> ${agentName}: ${command} (dist=${Math.round(dist)})`);
        gameState.sendDirective(agentName, command);
    }
}

async function waitForAgents(gameState, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        // Check if bots are connected
        if (gameState.connected && Object.keys(gameState.agentStates).length > 0) {
            // Try to detect player via RCON (works regardless of bot proximity)
            if (!gameState.playerName) {
                const playerName = await gameState.detectPlayerViaRcon();
                if (playerName) {
                    gameState.playerName = playerName;
                    // Also try to get their position
                    const pos = await gameState.getPlayerPositionViaRcon(playerName);
                    if (pos) gameState.playerPosition = pos;
                }
            }
            if (gameState.playerName) return;
        }
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

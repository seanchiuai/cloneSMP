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
    // Continuously stop bots while waiting so they don't waste health/hunger
    console.log('[Orchestrator] Waiting for hunters and a human player to join the game...');
    await waitForAgents(gameState);
    console.log(`[Orchestrator] All hunters are online and player "${gameState.playerName}" detected. Chase begins in 30 seconds...`);

    // Keep bots stopped during the 30s grace period
    // Also heal/feed them so they start the hunt at full stats
    for (let i = 0; i < 6; i++) {
        stopAllBots(gameState);
        await gameState.healAndFeedHunters();
        await sleep(5000);
    }

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

    // Fix #2: Arm hunters with weapons so they don't fight bare-handed
    console.log('[Orchestrator] Arming hunters...');
    await armHunters(gameState);

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
            await gameState.showGameOver('player_wins');
            break;
        }

        // Check if the player has been killed
        if (await gameState.isPlayerDead()) {
            console.log('[Orchestrator] PLAYER KILLED! The hunters win!');
            await gameState.showGameOver('hunters_win');
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

        // Fix #3: Keep hunters fed and healthy
        await gameState.healAndFeedHunters();

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

    // DESPERATION OVERRIDE: last 60 seconds — skip LLM, hardcode rush
    if (gameState.isDesperationPhase()) {
        console.log('[Orchestrator] DESPERATION MODE — All hunters rush!');
        // Give speed boost so hunters can actually close distance
        await gameState.applySpeedToHunters();
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
        const state = gameState.agentStates[agentName];
        let dist = Infinity;
        if (state?.gameplay?.position && gameState.playerPosition) {
            const pos = state.gameplay.position;
            const pp = gameState.playerPosition;
            dist = Math.sqrt((pos.x - pp.x) ** 2 + (pos.z - pp.z) ** 2);
        }

        // Always stop the bot first so it picks up the new command.
        // Without this, bots stuck in a stale goToPlayer ignore new directives.
        gameState.sendDirective(agentName, '!stop');

        let command;
        if (playerName && dist < 24) {
            // Fix #5: Wider attack range so bots don't stop short
            command = `!attackPlayer("${playerName}")`;
        } else if (playerName) {
            command = `!goToPlayer("${playerName}", 2)`;
        } else if (gameState.playerPosition) {
            const pp = gameState.playerPosition;
            command = `!goToCoordinates(${pp.x}, ${pp.y}, ${pp.z}, 2)`;
        } else {
            command = `!searchForEntity("player", 512)`;
        }

        console.log(`[Orchestrator] -> ${agentName}: ${command} (dist=${Math.round(dist)})`);
        gameState.sendDirective(agentName, command);
    }
}

/**
 * Fix #2: Give all hunters a weapon at hunt start via RCON.
 * Gives each bot an iron sword so they don't fight bare-handed.
 */
async function armHunters(gameState) {
    const cmds = [];
    for (const name of gameState.getAgentNames()) {
        cmds.push(`give ${name} iron_sword 1`);
        cmds.push(`give ${name} shield 1`);
    }
    await gameState.rconBatch(cmds);
    console.log('[Orchestrator] Armed all hunters with iron sword + shield');
}

/**
 * Stop all bots — cancels their current action and self-prompter loop.
 */
function stopAllBots(gameState) {
    for (const agentName of gameState.getAgentNames()) {
        gameState.sendDirective(agentName, '!stop');
    }
}

async function waitForAgents(gameState, timeoutMs = 120000) {
    const start = Date.now();
    let stopTick = 0;
    while (Date.now() - start < timeoutMs) {
        // Check if bots are connected
        if (gameState.connected && Object.keys(gameState.agentStates).length > 0) {
            // Stop bots every ~10s so they stay idle while waiting for the human
            stopTick++;
            if (stopTick % 5 === 0) {
                stopAllBots(gameState);
            }

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

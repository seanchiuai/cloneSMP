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
    console.log(`[Orchestrator] All hunters are online and player "${gameState.playerName}" detected.`);

    // === FULL RESET: Clear inventory, effects, XP, and reset health/hunger ===
    console.log('[Orchestrator] Resetting all players for new game...');
    await resetAllPlayers(gameState);

    // === SPAWN RESET: Teleport everyone to world spawn ===
    console.log('[Orchestrator] Teleporting all players to spawn...');
    await teleportAllToSpawn(gameState);

    // Freeze hunters in place (blindness + slowness + mining fatigue)
    console.log('[Orchestrator] Freezing hunters...');
    await freezeHunters(gameState);

    // Heal/feed hunters while frozen
    await gameState.healAndFeedHunters();

    // === HEAD START: 10-second countdown with title screens ===
    console.log('[Orchestrator] Starting 10-second head start for runner...');

    // Show "GET READY" to everyone
    await gameState.rconBatch([
        'title @a times 5 30 10',
        'title @a title {"text":"GET READY","color":"gold","bold":true}',
        'title @a subtitle {"text":"Hunters vs Runner","color":"yellow"}',
        'playsound minecraft:block.note_block.pling master @a',
    ]);
    await sleep(2000);

    // Tell the runner to RUN
    await gameState.rconBatch([
        `title ${gameState.playerName} times 5 30 10`,
        `title ${gameState.playerName} title {"text":"RUN!","color":"green","bold":true}`,
        `title ${gameState.playerName} subtitle {"text":"You have 10 seconds head start!","color":"white"}`,
        `playsound minecraft:entity.player.levelup master ${gameState.playerName}`,
    ]);
    // Tell hunters they're frozen
    for (const name of gameState.getAgentNames()) {
        await gameState.rconCommand(`title ${name} times 5 30 10`);
        await gameState.rconCommand(`title ${name} title {"text":"FROZEN","color":"red","bold":true}`);
        await gameState.rconCommand(`title ${name} subtitle {"text":"Hunters release in 10 seconds...","color":"gray"}`);
    }
    await sleep(2000);

    // Countdown 8..1 via actionbar
    for (let i = 8; i >= 1; i--) {
        const color = i <= 3 ? 'red' : i <= 5 ? 'yellow' : 'green';
        await gameState.rconBatch([
            `title @a actionbar {"text":"⏱ ${i} seconds until hunters are released!","color":"${color}","bold":true}`,
        ]);
        if (i <= 3) {
            await gameState.rconCommand(`playsound minecraft:block.note_block.hat master @a`);
        }
        // Keep hunters frozen during countdown
        stopAllBots(gameState);
        await sleep(1000);
    }

    // Unfreeze hunters
    console.log('[Orchestrator] Unfreezing hunters — HUNT BEGINS!');
    await unfreezeHunters(gameState);

    // Show "HUNT BEGINS!" to everyone
    await gameState.rconBatch([
        'title @a times 5 40 10',
        'title @a title {"text":"HUNT BEGINS!","color":"red","bold":true}',
        'title @a subtitle {"text":"Hunters have been released!","color":"white"}',
        'playsound minecraft:entity.ender_dragon.growl master @a',
    ]);

    // Initialize HUD before hunt starts
    await gameState.initHud();

    // Start death watcher BEFORE the hunt so we catch deaths immediately
    gameState.startDeathWatcher();

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

        // Check death FIRST — player dying should always trigger hunters_win
        if (gameState.isPlayerDead()) {
            console.log('[Orchestrator] PLAYER KILLED! The hunters win!');
            // Wait for player to respawn before showing title screen
            await sleep(3000);
            stopAllBots(gameState);
            await gameState.showGameOver('hunters_win');
            await sendPostGameReactions(gameState, 'hunters_win');
            break;
        }

        if (gameState.isHuntOver()) {
            console.log('[Orchestrator] TIME IS UP! The player survived!');
            stopAllBots(gameState);
            await gameState.showGameOver('player_wins');
            await sendPostGameReactions(gameState, 'player_wins');
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

    // Clean up
    gameState.stopDeathWatcher();
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

/**
 * Full reset for all players (bots + human) at the start of each game.
 * Clears inventory, effects, XP, and restores full health/hunger.
 * Also kills dropped items and clears old HUD elements.
 */
async function resetAllPlayers(gameState) {
    const cmds = [];
    const allPlayers = [...gameState.getAgentNames()];
    if (gameState.playerName) allPlayers.push(gameState.playerName);

    for (const name of allPlayers) {
        // Clear inventory
        cmds.push(`clear ${name}`);
        // Clear all effects (leftover glow, speed, etc.)
        cmds.push(`effect clear ${name}`);
        // Set gamemode survival (in case anything changed it)
        cmds.push(`gamemode survival ${name}`);
        // Restore full health and hunger
        cmds.push(`effect give ${name} minecraft:instant_health 1 10 true`);
        cmds.push(`effect give ${name} minecraft:saturation 1 10 true`);
        // Reset XP
        cmds.push(`xp set ${name} 0 levels`);
        cmds.push(`xp set ${name} 0 points`);
    }

    // Kill all dropped items on the ground (cleanup from previous game)
    cmds.push('kill @e[type=item]');
    // Kill leftover arrows
    cmds.push('kill @e[type=arrow]');
    // Remove old HUD elements if they exist (ignore errors)
    cmds.push('bossbar remove clonessmp:timer');
    cmds.push('scoreboard objectives remove hunterHUD');

    await gameState.rconBatch(cmds);
    // Wait a tick for instant_health/saturation to apply, then clear the leftover effects
    await sleep(500);
    for (const name of allPlayers) {
        await gameState.rconCommand(`effect clear ${name}`);
    }
    console.log('[Orchestrator] All players reset (inventory, effects, health, hunger, XP)');
}

/**
 * Teleport all players (bots + human) to world spawn point.
 * Uses ~ for Y to let the server find safe ground level.
 */
async function teleportAllToSpawn(gameState) {
    const cmds = [];
    // Teleport human player
    if (gameState.playerName) {
        cmds.push(`tp ${gameState.playerName} 0 ~ 0`);
    }
    // Teleport all bots
    for (const name of gameState.getAgentNames()) {
        cmds.push(`tp ${name} 0 ~ 0`);
    }
    await gameState.rconBatch(cmds);
}

/**
 * Freeze hunters with effects so they can't move during head start.
 */
async function freezeHunters(gameState) {
    const cmds = [];
    for (const name of gameState.getAgentNames()) {
        cmds.push(`effect give ${name} minecraft:slowness 15 255 true`);
        cmds.push(`effect give ${name} minecraft:blindness 15 0 true`);
        cmds.push(`effect give ${name} minecraft:mining_fatigue 15 255 true`);
        cmds.push(`effect give ${name} minecraft:jump_boost 15 250 true`); // level 250 = can't jump
    }
    await gameState.rconBatch(cmds);
}

/**
 * Remove freeze effects from hunters.
 */
async function unfreezeHunters(gameState) {
    const cmds = [];
    for (const name of gameState.getAgentNames()) {
        cmds.push(`effect clear ${name} minecraft:slowness`);
        cmds.push(`effect clear ${name} minecraft:blindness`);
        cmds.push(`effect clear ${name} minecraft:mining_fatigue`);
        cmds.push(`effect clear ${name} minecraft:jump_boost`);
    }
    await gameState.rconBatch(cmds);
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

/**
 * Send post-game celebration or rage reactions from each bot in character.
 */
async function sendPostGameReactions(gameState, outcome) {
    const winLines = {
        SamAltman: [
            "GG! That's what I call scaling intelligence to its logical conclusion.",
            "Another successful deployment. The AI safety people were worried for nothing.",
            "We did it! This is the future I've been fundraising for!",
        ],
        ElonMusk: [
            "GET REKT. That kill was more satisfying than launching a rocket.",
            "Lmaooo you got absolutely destroyed. Skill issue tbh.",
            "Too easy. I've seen harder challenges on Mars.",
        ],
        DarioAmodei: [
            "I want it noted that this kill was conducted within ethical guidelines.",
            "We eliminated the target safely and responsibly. Well done, team.",
            "The alignment worked. We hunted exactly who we intended to hunt.",
        ],
        JensenHuang: [
            "INCREDIBLE! That kill was powered by pure GPU acceleration!",
            "The leather jacket stays UNDEFEATED. Jensen Huang does NOT lose!",
            "That was like CUDA cores processing a tensor — fast and devastating!",
        ],
    };

    const loseLines = {
        SamAltman: [
            "This is a temporary setback. We'll pivot and iterate.",
            "We clearly need more funding. The model wasn't scaled enough.",
            "I'm calling an emergency board meeting about this failure.",
        ],
        ElonMusk: [
            "This is RIGGED. I'm buying Mojang and banning this player.",
            "Unacceptable. I'm firing the entire hunting team.",
            "Whatever. I didn't even want to win. I was busy thinking about Mars.",
        ],
        DarioAmodei: [
            "I blame the lack of safety guardrails on this hunting operation.",
            "Perhaps we should have spent more time on alignment before rushing in.",
            "This is what happens when you let Elon lead the strategy.",
        ],
        JensenHuang: [
            "NOT incredible. We need more cores. MORE CORES!",
            "This wouldn't have happened if everyone wore leather jackets like me.",
            "I refuse to accept this result. The benchmarks clearly show we should have won.",
        ],
    };

    const lines = outcome === 'hunters_win' ? winLines : loseLines;

    await sleep(2000);
    for (const name of gameState.getAgentNames()) {
        const pool = lines[name];
        if (!pool) continue;
        const line = pool[Math.floor(Math.random() * pool.length)];
        gameState.sendDialogueLine(name, line);
        await sleep(1500);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
    console.error('[Orchestrator] Fatal error:', err);
    process.exit(1);
});

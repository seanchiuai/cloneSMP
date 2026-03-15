import { io } from 'socket.io-client';
import { Rcon } from 'rcon-client';
import fs from 'fs';
import path from 'path';

/**
 * Manages connection to MindServer and maintains live state of all agents.
 * Tracks player position, elapsed time, and rolling history.
 */
export class GameStateManager {
    constructor(mindserverPort = 8080) {
        this.mindserverPort = mindserverPort;
        this.socket = null;
        this.agentStates = {}; // latest state keyed by agent name
        this.playerPosition = null; // last known player position {x, y, z}
        this.playerName = null;
        this.connected = false;
        this.huntStartTime = null; // set when hunt begins
        this.huntDurationMs = 2 * 60 * 1000; // 2 minutes
        this.cycleHistory = []; // last N cycles of {state, directives, timestamp}
        this.maxHistory = 3;
        this.playerDead = false; // set true instantly by log watcher on death
        this._logWatcher = null;
        this._logOffset = 0;
    }

    async connect() {
        this.socket = io(`http://localhost:${this.mindserverPort}`);

        await new Promise((resolve, reject) => {
            this.socket.on('connect', resolve);
            this.socket.on('connect_error', (err) => reject(err));
        });

        this.connected = true;
        console.log('[GameState] Connected to MindServer');

        // Subscribe to state updates
        this.socket.emit('listen-to-agents');

        this.socket.on('state-update', (states) => {
            this.agentStates = states;
            // Extract player position from any hunter that can see them
            for (const [agentName, state] of Object.entries(states)) {
                if (state?.nearby?.humanPlayers?.length > 0) {
                    this.playerName = state.nearby.humanPlayers[0];
                    // Try to extract player coordinates from nearby entities
                    if (state?.nearby?.entities) {
                        for (const entity of state.nearby.entities) {
                            if (entity.name === this.playerName || entity.type === 'player') {
                                this.playerPosition = {
                                    x: Math.round(entity.position?.x ?? entity.x ?? 0),
                                    y: Math.round(entity.position?.y ?? entity.y ?? 0),
                                    z: Math.round(entity.position?.z ?? entity.z ?? 0),
                                };
                                break;
                            }
                        }
                    }
                    // Fallback: estimate player position as near the hunter that sees them
                    if (!this.playerPosition && state?.gameplay?.position) {
                        const hp = state.gameplay.position;
                        this.playerPosition = { x: hp.x, y: hp.y, z: hp.z };
                    }
                }
            }
        });

        this.socket.on('disconnect', () => {
            console.warn('[GameState] Disconnected from MindServer');
            this.connected = false;
        });
    }

    startHunt() {
        this.huntStartTime = Date.now();
        console.log('[GameState] Hunt timer started! 2 minutes on the clock.');
    }

    getElapsedSeconds() {
        if (!this.huntStartTime) return 0;
        return Math.floor((Date.now() - this.huntStartTime) / 1000);
    }

    getRemainingSeconds() {
        return Math.max(0, Math.floor(this.huntDurationMs / 1000) - this.getElapsedSeconds());
    }

    isHuntOver() {
        return this.huntStartTime && this.getRemainingSeconds() <= 0;
    }

    isDesperationPhase() {
        return this.huntStartTime && this.getRemainingSeconds() <= 60;
    }

    getTimeInfo() {
        const elapsed = this.getElapsedSeconds();
        const remaining = this.getRemainingSeconds();
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        if (remaining <= 60) {
            return `ELAPSED: ${elapsed}s | REMAINING: ${timeStr} | ⚠️ DESPERATION MODE — ALL HUNTERS SPRINT TO PLAYER AND ATTACK! NO CRAFTING, NO FLANKING, JUST RUSH!`;
        } else if (remaining <= 120) {
            return `ELAPSED: ${elapsed}s | REMAINING: ${timeStr} | AGGRESSIVE — Chase relentlessly. Every hunter must be sprinting toward the player RIGHT NOW.`;
        } else {
            return `ELAPSED: ${elapsed}s | REMAINING: ${timeStr} | CHASE MODE — All hunters chase the player. No downtime. Sprint and attack.`;
        }
    }

    /**
     * Save a cycle's state and directives to rolling history.
     */
    addToHistory(stateString, directives) {
        this.cycleHistory.push({
            timestamp: this.getElapsedSeconds(),
            state: stateString,
            directives,
        });
        if (this.cycleHistory.length > this.maxHistory) {
            this.cycleHistory.shift();
        }
    }

    getHistoryBlock() {
        if (this.cycleHistory.length === 0) return '';
        let block = 'RECENT HISTORY (last cycles — use this to avoid repeating failed strategies):\n';
        for (const entry of this.cycleHistory) {
            block += `\n--- ${entry.timestamp}s into hunt ---\n`;
            block += `Directives given:\n`;
            for (const [name, dir] of Object.entries(entry.directives)) {
                block += `  ${name}: ${dir}\n`;
            }
        }
        return block;
    }

    /**
     * Op all hunters via RCON so they can use /effect commands.
     */
    async opHunters() {
        const rconHost = process.env.RCON_HOST || 'localhost';
        const rconPort = parseInt(process.env.RCON_PORT || '25575');
        const rconPassword = process.env.RCON_PASSWORD || 'clonessmp';

        let rcon;
        try {
            rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPassword });
            for (const agentName of this.getAgentNames()) {
                const resp = await rcon.send(`op ${agentName}`);
                console.log(`[GameState] RCON op ${agentName}: ${resp}`);
            }
        } catch (err) {
            console.error('[GameState] RCON failed — op bots manually:', err.message);
        } finally {
            if (rcon) await rcon.end().catch(() => {});
        }
    }

    /**
     * Apply glowing effect to all hunters via RCON so they're always visible to the player.
     */
    async applyGlowToHunters() {
        const cmds = [];
        for (const agentName of this.getAgentNames()) {
            // Clear existing glowing first to avoid "immune/stronger" conflict
            cmds.push(`effect clear ${agentName} minecraft:glowing`);
            cmds.push(`effect give ${agentName} minecraft:glowing infinite 0 true`);
        }
        await this.rconBatch(cmds);
        console.log('[GameState] Glow applied to all hunters');
    }

    /**
     * Apply speed boost to all hunters during desperation phase.
     */
    async applySpeedToHunters() {
        const cmds = [];
        for (const agentName of this.getAgentNames()) {
            cmds.push(`effect give ${agentName} minecraft:speed 10 1 true`);
        }
        await this.rconBatch(cmds);
    }

    /**
     * Make an agent execute a chat command (slash command).
     */
    sendChatCommand(agentName, command) {
        if (!this.socket || !this.connected) {
            console.warn(`[GameState] Not connected, cannot send command to ${agentName}`);
            return;
        }
        this.socket.emit('send-message', agentName, {
            from: 'Orchestrator',
            message: `!newAction("Execute this chat command exactly: ${command.replace(/"/g, "'")}")`
        });
    }

    /**
     * Send a directive message to a specific agent via MindServer.
     */
    sendDirective(agentName, message) {
        if (!this.socket || !this.connected) {
            console.warn(`[GameState] Not connected, cannot send directive to ${agentName}`);
            return;
        }
        this.socket.emit('send-message', agentName, {
            from: 'Orchestrator',
            message
        });
    }

    /**
     * Send a dialogue line to a specific agent to say in in-game chat.
     */
    sendDialogueLine(agentName, line) {
        // Use RCON to send dialogue as server-formatted chat, avoiding bot action interruption
        this.sendDialogueViaRcon(agentName, line);
    }

    async sendDialogueViaRcon(agentName, line) {
        const rconHost = process.env.RCON_HOST || 'localhost';
        const rconPort = parseInt(process.env.RCON_PORT || '25575');
        const rconPassword = process.env.RCON_PASSWORD || 'clonessmp';
        const safeLine = line.replace(/"/g, '\\"').replace(/\\/g, '');

        let rcon;
        try {
            rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPassword });
            await rcon.send(`tellraw @a {"text":"<${agentName}> ${safeLine}"}`);
        } catch (err) {
            // Silent fallback — dialogue is non-critical
        } finally {
            if (rcon) await rcon.end().catch(() => {});
        }
    }

    /**
     * Build a structured game state string for the LLM prompt.
     */
    buildGameStateString() {
        const lines = [];

        // Player info with coordinates
        if (this.playerName && this.playerPosition) {
            lines.push(`PLAYER: ${this.playerName} — last known position: (${this.playerPosition.x}, ${this.playerPosition.y}, ${this.playerPosition.z})`);
        } else if (this.playerName) {
            lines.push(`PLAYER: ${this.playerName} — position unknown, last seen near a hunter`);
        } else {
            lines.push(`PLAYER: position unknown — no hunter has visual contact`);
        }

        // Time of day (from any agent)
        const anyState = Object.values(this.agentStates)[0];
        if (anyState?.gameplay) {
            const t = anyState.gameplay.timeOfDay;
            lines.push(`TIME: ${anyState.gameplay.timeLabel} (tick ${t}), weather: ${anyState.gameplay.weather}`);
        }

        lines.push('');
        lines.push('HUNTERS:');

        for (const [name, state] of Object.entries(this.agentStates)) {
            if (!state || !state.gameplay) {
                lines.push(`- ${name}: offline or no state`);
                continue;
            }
            const g = state.gameplay;
            const pos = g.position;
            const inv = state.inventory?.counts || {};
            const topItems = Object.entries(inv)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([item, count]) => `${count}x${item}`)
                .join(', ');
            const action = state.action?.current || 'Unknown';
            const equipment = state.inventory?.equipment || {};
            const gear = [equipment.helmet, equipment.chestplate, equipment.leggings, equipment.boots, equipment.mainHand]
                .filter(Boolean).join(', ') || 'none';

            const canSeePlayer = state.nearby?.humanPlayers?.length > 0;

            // Calculate distance to player if possible
            let distToPlayer = '';
            if (this.playerPosition && pos) {
                const dx = pos.x - this.playerPosition.x;
                const dz = pos.z - this.playerPosition.z;
                const dist = Math.round(Math.sqrt(dx * dx + dz * dz));
                distToPlayer = `, dist_to_player=${dist} blocks`;
            }

            lines.push(`- ${name}: pos=(${pos.x}, ${pos.y}, ${pos.z}), health=${g.health}/20, hunger=${g.hunger}/20${distToPlayer}`);
            lines.push(`  gear: ${gear}`);
            lines.push(`  inventory: ${topItems || 'empty'}`);
            lines.push(`  action: ${action}`);
            lines.push(`  can_see_player: ${canSeePlayer}`);
        }

        return lines.join('\n');
    }

    /**
     * Send a single RCON command using a shared connection, or create one.
     */
    async rconCommand(cmd) {
        const rconHost = process.env.RCON_HOST || 'localhost';
        const rconPort = parseInt(process.env.RCON_PORT || '25575');
        const rconPassword = process.env.RCON_PASSWORD || 'clonessmp';

        let rcon;
        try {
            rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPassword });
            const resp = await rcon.send(cmd);
            return resp;
        } catch (err) {
            // silent
            return null;
        } finally {
            if (rcon) await rcon.end().catch(() => {});
        }
    }

    /**
     * Send multiple RCON commands in one connection.
     */
    async rconBatch(cmds) {
        const rconHost = process.env.RCON_HOST || 'localhost';
        const rconPort = parseInt(process.env.RCON_PORT || '25575');
        const rconPassword = process.env.RCON_PASSWORD || 'clonessmp';

        let rcon;
        try {
            rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPassword });
            for (const cmd of cmds) {
                await rcon.send(cmd);
            }
        } catch (err) {
            console.error('[GameState] RCON batch failed:', err.message);
        } finally {
            if (rcon) await rcon.end().catch(() => {});
        }
    }

    /**
     * Initialize the HUD: bossbar for timer, scoreboard sidebar for bot status.
     */
    async initHud() {
        const cmds = [
            // Create bossbar for hunt timer
            'bossbar add clonessmp:timer {"text":"Hunt Timer","color":"red"}',
            'bossbar set clonessmp:timer players @a',
            'bossbar set clonessmp:timer color red',
            'bossbar set clonessmp:timer style progress',
            'bossbar set clonessmp:timer max 120',
            'bossbar set clonessmp:timer value 120',
            'bossbar set clonessmp:timer visible true',
            'bossbar set clonessmp:timer name {"text":"⏱ 2:00 — HUNT BEGINS!","color":"red","bold":true}',

            // Create scoreboard for hunter status
            'scoreboard objectives add hunterHUD dummy {"text":"🎯 Hunter Status"}',
            'scoreboard objectives setdisplay sidebar hunterHUD',
        ];
        await this.rconBatch(cmds);
        console.log('[GameState] HUD initialized (bossbar + scoreboard)');
    }

    /**
     * Update the HUD with current timer and bot distances/health.
     */
    async updateHud() {
        const remaining = this.getRemainingSeconds();
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

        // Bossbar color based on time remaining
        let color = 'green';
        let label = `⏱ ${timeStr} remaining`;
        if (remaining <= 30) {
            color = 'red';
            label = `⚠ ${timeStr} — DESPERATION MODE!`;
        } else if (remaining <= 60) {
            color = 'yellow';
            label = `⏱ ${timeStr} — AGGRESSIVE PHASE`;
        }

        const cmds = [
            `bossbar set clonessmp:timer value ${remaining}`,
            `bossbar set clonessmp:timer color ${color}`,
            `bossbar set clonessmp:timer name {"text":"${label}","bold":true}`,
        ];

        // Update scoreboard with hunter info
        // First reset all scores
        cmds.push('scoreboard players reset * hunterHUD');

        for (const [name, state] of Object.entries(this.agentStates)) {
            if (!state?.gameplay) continue;

            const health = Math.round(state.gameplay.health || 0);
            let dist = '?';
            if (state.gameplay.position && this.playerPosition) {
                const pos = state.gameplay.position;
                const pp = this.playerPosition;
                dist = Math.round(Math.sqrt((pos.x - pp.x) ** 2 + (pos.z - pp.z) ** 2));
            }

            // Scoreboard value = distance (most useful info). Name shows who.
            // Use short display names for readability
            const shortName = name.replace('Altman', '').replace('Musk', '').replace('Amodei', '').replace('Huang', '');
            const displayKey = `${shortName} ❤${health} dist`;
            const distNum = dist === '?' ? 999 : dist;
            cmds.push(`scoreboard players set "${displayKey}" hunterHUD ${distNum}`);
        }

        await this.rconBatch(cmds);
    }

    /**
     * Clean up HUD elements.
     */
    async cleanupHud() {
        await this.rconBatch([
            'bossbar remove clonessmp:timer',
            'scoreboard objectives remove hunterHUD',
        ]);
    }

    /**
     * Check if the human player is dead (set by log watcher).
     */
    isPlayerDead() {
        return this.playerDead;
    }

    /**
     * Start watching the Minecraft server log for player death messages.
     * Death messages in MC always start with the player name (e.g. "Player was slain by ...").
     * This gives instant detection instead of polling health every cycle.
     */
    startDeathWatcher() {
        const logPath = path.resolve(import.meta.dirname, '..', 'server', 'logs', 'latest.log');
        try {
            const stats = fs.statSync(logPath);
            this._logOffset = stats.size; // only watch new lines from now
        } catch {
            console.warn('[GameState] Could not find server log, death watcher disabled');
            return;
        }

        // Death message patterns — player name always appears at start of the message
        const deathVerbs = [
            'was slain by', 'was shot by', 'was killed by', 'was fireballed by',
            'was pummeled by', 'was squashed by', 'was impaled by',
            'fell ', 'drowned', 'burned ', 'went up in flames',
            'tried to swim in lava', 'suffocated', 'starved',
            'blew up', 'hit the ground', 'experienced kinetic energy',
            'didn\'t want to live', 'withered away', 'was pricked',
            'walked into ', 'was frozen', 'was stung',
        ];

        const checkNewLines = () => {
            if (this.playerDead || !this.playerName) return;
            try {
                const stats = fs.statSync(logPath);
                if (stats.size <= this._logOffset) return;

                const buf = Buffer.alloc(stats.size - this._logOffset);
                const fd = fs.openSync(logPath, 'r');
                fs.readSync(fd, buf, 0, buf.length, this._logOffset);
                fs.closeSync(fd);
                this._logOffset = stats.size;

                const newLines = buf.toString('utf8').split('\n');
                for (const line of newLines) {
                    // Server log format: [HH:MM:SS] [Server thread/INFO]: PlayerName death message
                    const infoMatch = line.match(/\[Server thread\/INFO\]:\s*(.+)/);
                    if (!infoMatch) continue;
                    const msg = infoMatch[1];
                    if (!msg.startsWith(this.playerName)) continue;
                    const afterName = msg.slice(this.playerName.length + 1); // skip name + space
                    if (deathVerbs.some(v => afterName.startsWith(v))) {
                        console.log(`[GameState] DEATH DETECTED: ${msg}`);
                        this.playerDead = true;
                        return;
                    }
                }
            } catch {
                // silent — log file may be rotating
            }
        };

        // Poll the log file every 250ms for near-instant detection
        this._logWatcher = setInterval(checkNewLines, 250);
        console.log('[GameState] Death watcher started (watching server log)');
    }

    /**
     * Stop the death watcher.
     */
    stopDeathWatcher() {
        if (this._logWatcher) {
            clearInterval(this._logWatcher);
            this._logWatcher = null;
        }
    }

    /**
     * Show a full-screen game over message using title commands.
     * For hunters_win, waits for the player to respawn first so the title is visible.
     * @param {'hunters_win'|'player_wins'} outcome
     */
    async showGameOver(outcome) {
        if (outcome === 'hunters_win' && this.playerName) {
            // Wait for player to respawn (health > 0) before showing title
            for (let i = 0; i < 20; i++) { // up to 10s
                const resp = await this.rconCommand(`data get entity ${this.playerName} Health`);
                if (resp) {
                    const match = resp.match(/([\d.]+)f/);
                    if (match && parseFloat(match[1]) > 0) break;
                }
                await new Promise(r => setTimeout(r, 500));
            }
        }

        const cmds = [];
        if (outcome === 'hunters_win') {
            cmds.push('title @a times 10 100 40');
            cmds.push('title @a title {"text":"HUNTERS WIN!","color":"red","bold":true}');
            cmds.push('title @a subtitle {"text":"The player has been eliminated!","color":"gray"}');
            cmds.push('playsound minecraft:entity.ender_dragon.growl master @a');
        } else {
            cmds.push('title @a times 10 100 40');
            cmds.push('title @a title {"text":"YOU SURVIVED!","color":"green","bold":true}');
            cmds.push('title @a subtitle {"text":"The hunters failed to catch you!","color":"gray"}');
            cmds.push('playsound minecraft:ui.toast.challenge_complete master @a');
        }
        const resp = await this.rconBatch(cmds);
        console.log(`[GameState] Game over screen sent: ${outcome}`);
    }

    /**
     * Keep hunters fed and healthy via RCON. Apply saturation to any hunter
     * with low hunger, and regeneration to any with low health.
     */
    async healAndFeedHunters() {
        const cmds = [];
        for (const [name, state] of Object.entries(this.agentStates)) {
            if (!state?.gameplay) continue;
            const hunger = state.gameplay.hunger ?? 20;
            const health = state.gameplay.health ?? 20;
            if (hunger < 15) {
                cmds.push(`effect give ${name} minecraft:saturation 5 2 true`);
            }
            if (health < 10) {
                // Critical health: instant heal to prevent dying to mobs
                cmds.push(`effect give ${name} minecraft:instant_health 1 1 true`);
            } else if (health < 15) {
                cmds.push(`effect give ${name} minecraft:regeneration 5 2 true`);
            }
        }
        if (cmds.length > 0) {
            await this.rconBatch(cmds);
        }
    }

    getAgentNames() {
        return Object.keys(this.agentStates);
    }

    isReady() {
        return this.connected && Object.keys(this.agentStates).length > 0 && this.playerName !== null;
    }

    /**
     * Detect human player via RCON 'list' command.
     * Returns the first non-bot player name, or null.
     */
    async detectPlayerViaRcon() {
        const rconHost = process.env.RCON_HOST || 'localhost';
        const rconPort = parseInt(process.env.RCON_PORT || '25575');
        const rconPassword = process.env.RCON_PASSWORD || 'clonessmp';
        const botNames = new Set(this.getAgentNames());

        let rcon;
        try {
            rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPassword });
            const resp = await rcon.send('list');
            // Format: "There are X of a max of Y players online: name1, name2, ..."
            const match = resp.match(/:\s*(.+)/);
            if (match) {
                const players = match[1].split(',').map(s => s.trim()).filter(Boolean);
                for (const name of players) {
                    if (!botNames.has(name)) {
                        return name;
                    }
                }
            }
        } catch (err) {
            // silent
        } finally {
            if (rcon) await rcon.end().catch(() => {});
        }
        return null;
    }

    /**
     * Get player position via RCON 'data get entity' command.
     */
    async getPlayerPositionViaRcon(playerName) {
        const rconHost = process.env.RCON_HOST || 'localhost';
        const rconPort = parseInt(process.env.RCON_PORT || '25575');
        const rconPassword = process.env.RCON_PASSWORD || 'clonessmp';

        let rcon;
        try {
            rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPassword });
            const resp = await rcon.send(`data get entity ${playerName} Pos`);
            // Format: "Player has the following entity data: [x, y, z]"
            const match = resp.match(/\[(-?[\d.]+)d,\s*(-?[\d.]+)d,\s*(-?[\d.]+)d\]/);
            if (match) {
                return {
                    x: Math.round(parseFloat(match[1]) * 100) / 100,
                    y: Math.round(parseFloat(match[2]) * 100) / 100,
                    z: Math.round(parseFloat(match[3]) * 100) / 100,
                };
            }
        } catch (err) {
            // silent
        } finally {
            if (rcon) await rcon.end().catch(() => {});
        }
        return null;
    }
}

import { io } from 'socket.io-client';

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
        this.huntDurationMs = 3 * 60 * 1000; // 3 minutes
        this.cycleHistory = []; // last N cycles of {state, directives, timestamp}
        this.maxHistory = 3;
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
        console.log('[GameState] Hunt timer started! 3 minutes on the clock.');
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
        return this.huntStartTime && this.getRemainingSeconds() <= 30;
    }

    getTimeInfo() {
        const elapsed = this.getElapsedSeconds();
        const remaining = this.getRemainingSeconds();
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        if (remaining <= 30) {
            return `ELAPSED: ${elapsed}s | REMAINING: ${timeStr} | ⚠️ DESPERATION MODE — LESS THAN 30 SECONDS! ALL HUNTERS MUST SPRINT TO PLAYER AND ATTACK NOW! NO CRAFTING, NO FLANKING, JUST RUSH!`;
        } else if (remaining <= 60) {
            return `ELAPSED: ${elapsed}s | REMAINING: ${timeStr} | URGENT — Under 1 minute! Maximum aggression, minimal crafting.`;
        } else {
            return `ELAPSED: ${elapsed}s | REMAINING: ${timeStr} | Hunt smart — craft if needed, flank, use terrain.`;
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
     * Apply glowing effect to all hunters so they're always visible to the player.
     * Bots must be opped on the server (run `/op BotName` for each bot).
     */
    applyGlowToHunters() {
        for (const agentName of this.getAgentNames()) {
            this.sendChatCommand(agentName, `/effect give ${agentName} minecraft:glowing infinite 0 true`);
        }
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
        const safeLine = line.replace(/"/g, "'").replace(/\\/g, '');
        this.sendDirective(agentName, `!newAction("Say this in chat exactly: ${safeLine}")`);
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

    getAgentNames() {
        return Object.keys(this.agentStates);
    }

    isReady() {
        return this.connected && Object.keys(this.agentStates).length > 0 && this.playerName !== null;
    }
}

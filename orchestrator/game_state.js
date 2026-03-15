import { io } from 'socket.io-client';

/**
 * Manages connection to MindServer and maintains live state of all agents.
 * Also runs a spectator-style Mineflayer bot to track the human player position.
 */
export class GameStateManager {
    constructor(mindserverPort = 8080) {
        this.mindserverPort = mindserverPort;
        this.socket = null;
        this.agentStates = {}; // latest state keyed by agent name
        this.playerPosition = null; // last known player position
        this.playerName = null;
        this.connected = false;
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
                }
            }
        });

        this.socket.on('disconnect', () => {
            console.warn('[GameState] Disconnected from MindServer');
            this.connected = false;
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
     * Send a chat message to all agents (used for dialogue display).
     */
    broadcastDialogue(dialogue) {
        for (const agentName of Object.keys(this.agentStates)) {
            this.socket.emit('send-message', agentName, {
                from: 'Orchestrator',
                message: `[BROADCAST] ${dialogue}`
            });
        }
    }

    /**
     * Build a structured game state string for the LLM prompt.
     */
    buildGameStateString() {
        const lines = [];

        // Player info
        if (this.playerName) {
            lines.push(`PLAYER: ${this.playerName} - last seen near one of the hunters`);
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
                .slice(0, 6)
                .map(([item, count]) => `${count}x${item}`)
                .join(', ');
            const action = state.action?.current || 'Unknown';
            const equipment = state.inventory?.equipment || {};
            const gear = [equipment.helmet, equipment.chestplate, equipment.leggings, equipment.boots, equipment.mainHand]
                .filter(Boolean).join(', ') || 'none';

            const canSeePlayer = state.nearby?.humanPlayers?.length > 0;

            lines.push(`- ${name}: pos=(${pos.x}, ${pos.y}, ${pos.z}), health=${g.health}/20, hunger=${g.hunger}/20, biome=${g.biome}`);
            lines.push(`  gear: ${gear}`);
            lines.push(`  inventory: ${topItems || 'empty'}`);
            lines.push(`  action: ${action}`);
            lines.push(`  can_see_player: ${canSeePlayer}`);
        }

        // Determine hunt phase
        const allInventories = Object.values(this.agentStates).map(s => s?.inventory?.counts || {});
        const hasIronGear = allInventories.some(inv => (inv['iron_sword'] || 0) > 0 || (inv['iron_pickaxe'] || 0) > 0);
        const hasBlaze = allInventories.some(inv => (inv['blaze_rod'] || 0) > 0 || (inv['blaze_powder'] || 0) > 0);
        const anyCanSeePlayer = Object.values(this.agentStates).some(s => s?.nearby?.humanPlayers?.length > 0);

        let phase = 'early_game';
        if (hasBlaze) phase = 'end_rush';
        else if (hasIronGear) phase = 'active_hunt';
        else if (anyCanSeePlayer) phase = 'combat';

        lines.push('');
        lines.push(`HUNT PHASE: ${phase}`);

        return lines.join('\n');
    }

    getAgentNames() {
        return Object.keys(this.agentStates);
    }

    isReady() {
        return this.connected && Object.keys(this.agentStates).length > 0;
    }
}

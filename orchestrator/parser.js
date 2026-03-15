/**
 * Parses the LLM response into dialogue lines and per-agent directives.
 *
 * Expected format:
 * [DIALOGUE]
 * SamAltman: "..."
 * ElonMusk: "..."
 * DarioAmodei: "..."
 * JensenHuang: "..."
 *
 * [DIRECTIVES]
 * SamAltman: <directive>
 * ElonMusk: <directive>
 * DarioAmodei: <directive>
 * JensenHuang: <directive>
 */
export function parseOrchestratorResponse(text) {
    const result = {
        dialogue: [],   // Array of { name, line }
        directives: {}, // { agentName: directiveString }
        raw: text,
    };

    if (!text) return result;

    const dialogueMatch = text.match(/\[DIALOGUE\]([\s\S]*?)(?=\[DIRECTIVES\]|$)/i);
    const directivesMatch = text.match(/\[DIRECTIVES\]([\s\S]*?)$/i);

    if (dialogueMatch) {
        const dialogueBlock = dialogueMatch[1].trim();
        for (const line of dialogueBlock.split('\n')) {
            const match = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
            if (match) {
                result.dialogue.push({ name: match[1], line: match[2] });
            }
        }
    }

    if (directivesMatch) {
        const directivesBlock = directivesMatch[1].trim();
        for (const line of directivesBlock.split('\n')) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                result.directives[match[1]] = match[2].trim();
            }
        }
    }

    return result;
}

/**
 * Role-aware fallback directives when LLM fails.
 * Uses player position when available for targeted chasing.
 */
export function getFallbackDirectives(agentNames, playerPosition, playerName) {
    const playerTarget = playerPosition
        ? `Go to coordinates (${playerPosition.x}, ${playerPosition.y}, ${playerPosition.z}) where ${playerName || 'the player'} was last seen.`
        : `Use !entities to locate ${playerName || 'the player'}.`;

    const fallbacks = {
        SamAltman: `${playerTarget} Coordinate with nearby hunters — call out the player's position if you see them. Attack on sight.`,
        ElonMusk: `${playerTarget} Sprint directly at the player and attack immediately. Don't wait for anyone.`,
        DarioAmodei: `Check if you have a weapon. If not, quickly craft a wooden sword (collect 2 planks + 1 stick). Then ${playerTarget.toLowerCase()} Approach from a different angle than the others.`,
        JensenHuang: `${playerTarget} Move to cut off escape routes. If the player is heading toward a cave or water, get there first. Build a dirt bridge if needed to close distance.`,
    };

    const result = {};
    for (const name of agentNames) {
        result[name] = fallbacks[name] || `${playerTarget} Hunt and attack the player.`;
    }
    return result;
}

/**
 * Desperation directives for the final 30 seconds.
 * Bypasses LLM entirely — pure rush.
 */
export function getDesperationDirectives(agentNames, playerPosition, playerName) {
    const target = playerPosition
        ? `Sprint to (${playerPosition.x}, ${playerPosition.y}, ${playerPosition.z}) and attack ${playerName || 'the player'} immediately!`
        : `Use !entities to find ${playerName || 'the player'} and sprint attack them NOW!`;

    const result = {};
    for (const name of agentNames) {
        result[name] = `FINAL SECONDS! ${target} Do not stop for anything. Attack attack attack!`;
    }
    return result;
}

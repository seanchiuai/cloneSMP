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
 * Fallback directives when LLM fails or produces bad output.
 */
export function getFallbackDirectives(agentNames) {
    const fallbacks = {
        SamAltman: 'Find the player and coordinate with your team to surround them. Use !entities to locate the player.',
        ElonMusk: 'Rush toward the player immediately. Use !entities to find them and attack on sight.',
        DarioAmodei: 'Carefully scout the area for the player. Use !entities to check surroundings before engaging.',
        JensenHuang: 'Flank around to cut off the player\'s escape. Use !entities to locate them and move to intercept.',
    };

    const result = {};
    for (const name of agentNames) {
        result[name] = fallbacks[name] || 'Hunt the player. Use !entities to find them and attack.';
    }
    return result;
}

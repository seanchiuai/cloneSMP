import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYSTEM_PROMPT_TEMPLATE = readFileSync(path.join(__dirname, 'prompt.txt'), 'utf8');

const client = new OpenAI({
    apiKey: process.env.NEBIUS_API_KEY,
    baseURL: 'https://api.tokenfactory.nebius.com/v1/',
});

const MODEL = process.env.ORCHESTRATOR_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-fast';

// Rolling conversation history for continuity across cycles
const conversationHistory = [];
const MAX_HISTORY_MESSAGES = 6; // 3 cycles of assistant+user pairs

/**
 * Call the Nebius LLM with the current game state, time info, and history.
 * Maintains rolling conversation history so the LLM can reason about past cycles.
 */
export async function callOrchestrator(gameStateString, timeInfo, historyBlock) {
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
        .replace('$GAME_STATE', gameStateString)
        .replace('$TIME_INFO', timeInfo || 'Hunt timer not started yet.')
        .replace('$HISTORY_BLOCK', historyBlock || '');

    // Build the user message for this cycle
    const userMessage = `Generate celebrity dialogue and hunting directives for this cycle. Remember: Dario HATES Sam — make sure their bickering shows. Time is ticking!`;

    // Build messages array with rolling history
    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage },
    ];

    try {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages,
            max_tokens: 800,
            temperature: 0.85,
        });

        const content = response.choices[0]?.message?.content || '';

        // Save to rolling history
        if (content) {
            conversationHistory.push(
                { role: 'user', content: userMessage },
                { role: 'assistant', content }
            );
            // Trim history to keep it bounded
            while (conversationHistory.length > MAX_HISTORY_MESSAGES) {
                conversationHistory.shift();
            }
        }

        return content;
    } catch (err) {
        console.error('[LLM] Error calling Nebius API:', err.message);
        return null;
    }
}

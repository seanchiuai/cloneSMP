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

/**
 * Call the Nebius LLM with the current game state.
 * Returns the raw response text.
 */
export async function callOrchestrator(gameStateString) {
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('$GAME_STATE', gameStateString);

    try {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Generate the celebrity dialogue and hunting directives based on the current game state.' }
            ],
            max_tokens: 800,
            temperature: 0.85,
        });

        return response.choices[0]?.message?.content || '';
    } catch (err) {
        console.error('[LLM] Error calling Nebius API:', err.message);
        return null;
    }
}

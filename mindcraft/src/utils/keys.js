import { readFileSync } from 'fs';

let keys = {};

// Load from root .env (one level up from mindcraft/)
try {
    const envData = readFileSync('../.env', 'utf8');
    for (const line of envData.split('\n')) {
        const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
        if (match) keys[match[1]] = match[2];
    }
} catch (_) {}

// keys.json overrides root .env
try {
    const data = readFileSync('./keys.json', 'utf8');
    Object.assign(keys, JSON.parse(data));
} catch (err) {
    console.warn('keys.json not found. Defaulting to environment variables.'); // still works with local models
}

export function getKey(name) {
    let key = keys[name];
    if (!key) {
        key = process.env[name];
    }
    if (!key) {
        throw new Error(`API key "${name}" not found in keys.json or environment variables!`);
    }
    return key;
}

export function hasKey(name) {
    return keys[name] || process.env[name];
}

#!/usr/bin/env node
/**
 * set_skins.js — Copy skin PNGs into SkinsRestorer's local folder, then apply via RCON.
 * Run after bots have joined the server.
 *
 * Usage: node scripts/set_skins.js
 * Env:   RCON_PASS (default: clonessmp), RCON_PORT (default: 25575)
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RCON_HOST = '127.0.0.1';
const RCON_PORT = parseInt(process.env.RCON_PORT || '25575');
const RCON_PASS = process.env.RCON_PASS || 'clonessmp';

const SR_SKINS_DIR = path.join(ROOT, 'server', 'plugins', 'SkinsRestorer', 'skins');

const SKINS = [
    { bot: 'SamAltman',   file: 'sam.png' },
    { bot: 'ElonMusk',    file: 'elon.png' },
    { bot: 'DarioAmodei', file: 'dario.png' },
    { bot: 'JensenHuang', file: 'jensen.png' },
];

function buildPacket(id, type, body) {
    const bodyBuf = Buffer.from(body + '\0', 'ascii');
    const packet = Buffer.alloc(4 + 4 + 4 + bodyBuf.length + 1);
    packet.writeInt32LE(4 + 4 + bodyBuf.length + 1, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    bodyBuf.copy(packet, 12);
    packet.writeUInt8(0, 12 + bodyBuf.length);
    return packet;
}

function rconExec(command) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(RCON_PORT, RCON_HOST);
        let buf = Buffer.alloc(0);
        let authed = false;

        socket.setTimeout(6000);
        socket.on('timeout', () => { reject(new Error('RCON timeout')); socket.destroy(); });
        socket.on('error', reject);
        socket.on('connect', () => socket.write(buildPacket(1, 3, RCON_PASS)));

        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 14) {
                const len = buf.readInt32LE(0);
                if (buf.length < len + 4) break;
                const id   = buf.readInt32LE(4);
                const body = buf.slice(12, len + 4 - 2).toString('utf8');
                buf = buf.slice(len + 4);

                if (!authed) {
                    if (id === -1) { reject(new Error('RCON auth failed')); socket.destroy(); return; }
                    authed = true;
                    socket.write(buildPacket(2, 2, command));
                } else {
                    resolve(body);
                    socket.destroy();
                }
            }
        });
    });
}

async function main() {
    // 1. Copy skin PNGs into SkinsRestorer's skins folder
    fs.mkdirSync(SR_SKINS_DIR, { recursive: true });
    for (const { bot, file } of SKINS) {
        const src = path.join(ROOT, 'skins', file);
        const dest = path.join(SR_SKINS_DIR, file);
        if (!fs.existsSync(src)) {
            console.warn(`[Skins] Missing: skins/${file} — skipping ${bot}`);
            continue;
        }
        fs.copyFileSync(src, dest);
        console.log(`[Skins] Copied ${file} → SkinsRestorer/skins/`);
    }

    // 2. Connect RCON
    console.log('[Skins] Connecting to RCON...');
    try {
        await rconExec('list');
        console.log('[Skins] Connected.');
    } catch (err) {
        console.error('[Skins] RCON failed:', err.message);
        process.exit(1);
    }

    // 3. Apply skins
    for (const { bot, file } of SKINS) {
        const skinName = file.replace('.png', '');
        try {
            const res = await rconExec(`sr set ${bot} ${skinName}`);
            console.log(`[Skins] ${bot}: ${res || 'ok'}`);
        } catch (err) {
            console.error(`[Skins] ${bot} failed:`, err.message);
        }
        await new Promise(r => setTimeout(r, 600));
    }

    console.log('[Skins] Done. Kick and rejoin bots to see skins.');
}

main();

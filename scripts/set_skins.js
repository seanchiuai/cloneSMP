#!/usr/bin/env node
/**
 * set_skins.js — Apply SkinsRestorer skins to all 4 hunters via RCON.
 * Run after bots have joined the server.
 *
 * If a skin fails, run manually in-game as op:
 *   /sr url <BotName> <url>
 *
 * Usage: node scripts/set_skins.js
 * Env:   RCON_PASS (default: clonessmp), RCON_PORT (default: 25575)
 */

import net from 'net';

const RCON_HOST = '127.0.0.1';
const RCON_PORT = parseInt(process.env.RCON_PORT || '25575');
const RCON_PASS = process.env.RCON_PASS || 'clonessmp';

// NOTE: URLs must return a direct PNG with no redirect chain.
// Sam (ChatGPT/OpenAI skin) and Elon (direct S3) are confirmed working.
// Dario: claude-ia skin from minecraftskins.com
// Jensen: UPDATE THIS — go to namemc.com/skin/6c2a29744a6732c2, right-click
//         the Download button, copy the direct .png URL, paste it below.
const SKINS = [
    { bot: 'SamAltman',   url: 'https://www.minecraftskins.com/skin/download/22755637/' },
    { bot: 'ElonMusk',    url: 'https://skinsmc.s3.us-east-2.amazonaws.com/3ee42b505f824f55a548023c8c2561c1' },
    { bot: 'DarioAmodei', url: 'https://www.minecraftskins.com/skin/download/23191521/' },
    { bot: 'JensenHuang', url: 'REPLACE_WITH_DIRECT_PNG_URL' }, // see note above
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
                    if (id === -1) { reject(new Error('RCON auth failed — check RCON_PASS')); socket.destroy(); return; }
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
    console.log('[Skins] Connecting to RCON...');
    try {
        await rconExec('list');
        console.log('[Skins] Connected.');
    } catch (err) {
        console.error('[Skins] RCON failed:', err.message);
        console.error('[Skins] Is the server running with enable-rcon=true?');
        process.exit(1);
    }

    for (const { bot, url } of SKINS) {
        if (url.startsWith('REPLACE_')) {
            console.warn(`[Skins] ${bot}: skipped — URL not set. See comment in set_skins.js.`);
            continue;
        }
        try {
            const res = await rconExec(`sr url ${bot} ${url}`);
            console.log(`[Skins] ${bot}: ${res || 'ok'}`);
        } catch (err) {
            console.error(`[Skins] ${bot} failed:`, err.message);
        }
        await new Promise(r => setTimeout(r, 600));
    }

    console.log('[Skins] Done.');
}

main();

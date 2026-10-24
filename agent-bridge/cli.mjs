#!/usr/bin/env node
import { startBridge, codexIdentity } from './server.mjs';
import { resolve } from 'node:path';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--url', '--verify-origin', '--evidence', '--lease-minutes', '--port'].includes(key) || !args[i + 1]) throw new Error('Usage: node agent-bridge/cli.mjs --url https://example.com [--verify-origin https://example.com --evidence /absolute/evidence.json] [--lease-minutes 15]');
    options[key] = args[i + 1];
}
if (!options['--url']) throw new Error('--url is required');
if (!!options['--verify-origin'] !== !!options['--evidence']) throw new Error('Use --verify-origin and --evidence together; verification is opt-in.');
const bridge = await startBridge({ actor: codexIdentity(), target: options['--url'], verifyOrigin: options['--verify-origin'], evidenceFile: options['--evidence'] ? resolve(options['--evidence']) : null, leaseMinutes: Number(options['--lease-minutes'] || 15), port: Number(options['--port'] || 0) });
console.log(JSON.stringify({ launch_url: bridge.launchUrl, end_url: bridge.endUrl, expires_at: new Date(bridge.expires).toISOString(), identity_source: 'Codex environment', instructions: 'Open launch_url in the browser tab you will control. Wait for Attributed to Codex, then use Continue. Open end_url in the same tab when finished.' }, null, 2));
const timer = setTimeout(() => bridge.server.close(), bridge.expires - Date.now());
process.on('SIGINT', () => { clearTimeout(timer); bridge.server.close(); });
process.on('SIGTERM', () => { clearTimeout(timer); bridge.server.close(); });

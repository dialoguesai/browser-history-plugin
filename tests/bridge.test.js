import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { startBridge, codexIdentity } from '../agent-bridge/server.mjs';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const memory = () => {
    const data = {};
    return { async get(keys) { return structuredClone(keys == null ? data : typeof keys === 'string' ? { [keys]: data[keys] } : Object.fromEntries(keys.map(k => [k, data[k]]))); }, async set(v) { Object.assign(data, structuredClone(v)); }, async remove(k) { delete data[k]; } };
};
const urls = new Map();
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'WebExtension test browser' }, configurable: true });
globalThis.chrome = {
    storage: { session: memory(), local: memory(), sync: memory() },
    runtime: { id: 'plugin', getURL: p => `chrome-extension://plugin/${p}`, getManifest: () => ({ version: '3.1.0' }), onMessageExternal: event() },
    tabs: { get: async id => ({ id, url: urls.get(id), groupId: -1 }), query: async () => [], onUpdated: event(), onCreated: event(), onRemoved: event(), onReplaced: event() },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} }
};
const { bridgeLocation, connectAgentTab, recordBridgeDelivery } = await import('../lib/agentBridge.js');
const { captureActor, handleActorMessage } = await import('../lib/actorRuntime.js');
const actor = codexIdentity({ CODEX_THREAD_ID: '12345678-1234-1234-1234-123456789abc' });
const path = '/.well-known/topos-agent/v1/';
const post = (bridge, endpoint, bearer, body, headers = {}) => fetch(bridge.origin + path + endpoint, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'X-Topos-Agent-Bridge': '1', ...headers }, body: JSON.stringify(body) });
const status = bridge => fetch(bridge.origin + path + 'status', { headers: { Authorization: `Bearer ${new URL(bridge.launchUrl).hash.slice(1)}` } }).then(r => r.json());

test('Codex adapter reads exact current identity; missing/conflicting IDs fail closed', () => {
    assert.equal(actor.conversation_id, 'codex:12345678-1234-1234-1234-123456789abc');
    assert.throws(() => codexIdentity({}), /No valid/);
    assert.throws(() => codexIdentity({ CODEX_THREAD_ID: '12345678-1234-1234-1234-123456789abc', CODEX_SESSION_ID: 'different' }), /Conflicting/);
    for (const url of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://127.0.0.1.evil:1234', 'http://user@127.0.0.1:1234']) assert.equal(bridgeLocation(url + path + 'connect#' + 'a'.repeat(64)), null);
});

test('real HTTP bridge automatically attributes one tab, records activity, survives replacement and ends', async t => {
    const bridge = await startBridge({ actor, target: 'https://example.com/', verifyOrigin: 'https://example.com' });
    t.after(() => bridge.close());
    urls.set(1, bridge.launchUrl);
    await connectAgentTab(1, bridge.launchUrl);
    const identity = await captureActor(1);
    assert.equal(identity.conversation_id, actor.conversation_id);
    assert.equal(identity.method, 'controller_declared');
    assert.equal((await captureActor(2)).kind, 'unknown');
    assert.equal((await status(bridge)).ack.actor.session_id, identity.session_id);
    // A second tab cannot claim the same capability. Retrying the first is safe.
    urls.set(2, bridge.launchUrl);
    await assert.rejects(connectAgentTab(2, bridge.launchUrl), /409/);
    await connectAgentTab(1, bridge.launchUrl);
    const record = { capture_id: randomUUID(), tab_id: 1, url: 'https://example.com/proof', actor: identity };
    await recordBridgeDelivery('browser_visits', [record], { sent: false, reason: 'not_attached' });
    await recordBridgeDelivery('browser_visits', [{ ...record, url: 'https://private.example/' }], { sent: true });
    const evidence = await status(bridge);
    assert.equal(evidence.receipts.length, 1);
    assert.deepEqual(evidence.receipts[0].records[0], record);
    assert.equal(evidence.receipts[0].delivery.reason, 'not_attached');
    for (const listener of chrome.tabs.onReplaced.listeners) listener(3, 1);
    urls.set(3, bridge.endUrl);
    await connectAgentTab(3, bridge.endUrl);
    assert.equal((await captureActor(3)).kind, 'unknown');
    assert.equal((await status(bridge)).ended, true);
});

test('remote pages, bad hosts, expired tickets and mismatched receipts are rejected', async t => {
    let now = Date.now();
    const bridge = await startBridge({ actor, target: 'https://example.com/', now: () => now, ticketMs: 50 });
    t.after(() => bridge.close());
    const ticket = new URL(bridge.launchUrl).hash.slice(1);
    assert.equal((await post(bridge, 'claim', ticket, { client_id: randomUUID() }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(bridge, 'claim', ticket, { client_id: randomUUID() }, { Origin: bridge.origin })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
        const req = http.request(bridge.origin + path + 'claim', { method: 'POST', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end();
    });
    assert.equal(hostStatus, 403);
    now += 51;
    assert.equal((await post(bridge, 'claim', ticket, { client_id: randomUUID() })).status, 410);
});

test('manual human handoff cannot be undone by a stale end capability', async t => {
    const bridge = await startBridge({ actor, target: 'https://example.com/' });
    t.after(() => bridge.close());
    urls.set(10, bridge.launchUrl);
    await connectAgentTab(10, bridge.launchUrl);
    await handleActorMessage({ type: 'ACTOR_SET', tab_id: 10, actor: { kind: 'human' } }, { id: 'plugin', url: 'chrome-extension://plugin/controller.html' });
    urls.set(10, bridge.endUrl);
    await assert.rejects(connectAgentTab(10, bridge.endUrl), /no longer owns/);
    assert.equal((await captureActor(10)).kind, 'human');
    urls.set(10, bridge.launchUrl);
    await assert.rejects(connectAgentTab(10, bridge.launchUrl), /has ended/);
    assert.equal((await status(bridge)).ended, true);
    assert.equal((await captureActor(10)).kind, 'human');
});

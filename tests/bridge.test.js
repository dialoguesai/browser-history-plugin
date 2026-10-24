import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { startBridge, codexIdentity, claudeCodeIdentity, agentIdentity } from '../agent-bridge/server.mjs';
import { PendingActivity } from '../lib/pendingActivity.js';

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
const { captureActor, handleActorMessage, bindPending } = await import('../lib/actorRuntime.js');
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

test('Claude Code adapter reads its transcript ID; agent choice never guesses between nested agents', () => {
    const id = '87654321-4321-4321-4321-cba987654321', codex = { CODEX_THREAD_ID: '12345678-1234-1234-1234-123456789abc' }, claude = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: id };
    assert.deepEqual(claudeCodeIdentity(claude), { kind: 'agent', provider: 'Anthropic', name: 'Claude', conversation_source: 'claude_code_sessions', conversation_id: `claude_code:${id}` });
    assert.throws(() => claudeCodeIdentity({ CLAUDE_CODE_SESSION_ID: id }), /No valid/);
    assert.throws(() => claudeCodeIdentity({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'not-a-uuid' }), /No valid/);
    assert.equal(agentIdentity(claude).name, 'Claude');
    assert.equal(agentIdentity(codex).name, 'Codex');
    assert.throws(() => agentIdentity({ ...codex, ...claude }), /pass --agent/);
    assert.equal(agentIdentity({ ...codex, ...claude }, 'claude').conversation_id, `claude_code:${id}`);
    assert.throws(() => agentIdentity(codex, 'claude'), /No valid CLAUDE_CODE_SESSION_ID/);
    assert.throws(() => agentIdentity({}), /No supported agent/);
    assert.throws(() => agentIdentity(claude, 'cursor'), /Unknown agent/);
});

test('real HTTP bridge hands a Claude identity to the extension unchanged', async t => {
    const claude = claudeCodeIdentity({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: '87654321-4321-4321-4321-cba987654321' });
    const bridge = await startBridge({ actor: claude, target: 'https://example.com/' });
    t.after(() => bridge.close());
    urls.set(41, bridge.launchUrl);
    await connectAgentTab(41, bridge.launchUrl);
    const identity = await captureActor(41);
    for (const key of Object.keys(claude)) assert.equal(identity[key], claude[key]);
    assert.equal((await status(bridge)).ack.actor.conversation_id, claude.conversation_id);
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

test('same-tab human handoff preserves queued agent records and rejects stale control', async t => {
    const bridge = await startBridge({ actor, target: 'https://example.com/' });
    t.after(() => { bindPending(null); bridge.close(); });
    let now = 100;
    const sent = [];
    const pending = new PendingActivity(memory(), async item => {
        sent.push(JSON.parse(JSON.stringify(item.record)));
        return { topos: { sent: true } };
    }, { now: () => now, holdMs: 50 });
    bindPending(pending);
    urls.set(10, bridge.launchUrl);
    await connectAgentTab(10, bridge.launchUrl);
    const before = await captureActor(10);
    await pending.add({ record: { capture_id: 'before-handoff', tab_id: 10, actor: before } });
    await handleActorMessage({ type: 'ACTOR_SET', tab_id: 10, actor: { kind: 'human' } }, { id: 'plugin', url: 'chrome-extension://plugin/controller.html' });
    const after = await captureActor(10);
    await pending.add({ record: { capture_id: 'after-handoff', tab_id: 10, actor: after } });
    now = 151;
    await pending.flush();
    assert.equal(sent[0].actor.kind, 'agent');
    assert.equal(sent[0].actor.conversation_id, actor.conversation_id);
    assert.equal(sent[1].actor.kind, 'human');
    for (const field of ['provider', 'name', 'conversation_source', 'conversation_id']) assert.equal(sent[1].actor[field], undefined);
    assert.equal((await captureActor(11)).kind, 'unknown');
    urls.set(10, bridge.endUrl);
    await assert.rejects(connectAgentTab(10, bridge.endUrl), /no longer owns/);
    assert.equal((await captureActor(10)).kind, 'human');
    urls.set(10, bridge.launchUrl);
    await assert.rejects(connectAgentTab(10, bridge.launchUrl), /has ended/);
    assert.equal((await status(bridge)).ended, true);
    assert.equal((await captureActor(10)).kind, 'human');
});

test('handoff acknowledges before pending delivery waits on the bridge queue', async t => {
    const bridge = await startBridge({ actor, target: 'https://example.com/', verifyOrigin: 'https://example.com' });
    t.after(() => { bindPending(null); bridge.close(); });
    bindPending({ resolve: async (tabId, identity) => {
        await recordBridgeDelivery('browser_visits', [{
            capture_id: randomUUID(), tab_id: tabId, url: 'https://example.com/pending', actor: identity
        }], { sent: true, status: 200 });
    } });
    urls.set(20, bridge.launchUrl);
    let timer;
    try {
        const result = await Promise.race([
            connectAgentTab(20, bridge.launchUrl).then(() => 'complete'),
            new Promise(resolve => { timer = setTimeout(() => resolve('deadlock'), 1500); })
        ]);
        assert.equal(result, 'complete');
        const evidence = await status(bridge);
        assert.equal(evidence.ack.actor.conversation_id, actor.conversation_id);
        assert.equal(evidence.receipts.length, 1);
        assert.equal(evidence.receipts[0].delivery.status, 200);
    } finally { clearTimeout(timer); }
});

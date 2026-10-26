import test from 'node:test';
import assert from 'node:assert/strict';

const event = () => ({ addListener() {} });
const memory = () => {
    const data = {};
    return { async get(keys) { return structuredClone(typeof keys === 'string' ? { [keys]: data[keys] } : Object.fromEntries(keys.map(k => [k, data[k]]))); }, async set(value) { Object.assign(data, structuredClone(value)); }, async remove(key) { delete data[key]; } };
};
const icons = new Map(), badges = new Map(), titles = new Map();
globalThis.chrome = {
    storage: { session: memory(), sync: memory(), local: memory() },
    runtime: { getURL: p => `chrome-extension://plugin/${p}`, onMessageExternal: event() },
    tabs: { get: async id => ({ id, groupId: -1 }), onCreated: event(), onRemoved: event(), onUpdated: event(), onReplaced: event() },
    action: {
        async setIcon({ tabId, ...icon }) { icons.set(tabId, icon); },
        async setBadgeText({ tabId, text }) { badges.set(tabId, text); },
        async setTitle({ tabId, title }) { titles.set(tabId, title); },
        async setBadgeBackgroundColor() {}
    }
};
// Exercise asynchronous icon loading without depending on a browser canvas in Node.
let loads = 0;
globalThis.fetch = async () => { loads++; await new Promise(resolve => setTimeout(resolve, 1)); return { ok: true, blob: async () => ({}) }; };
globalThis.createImageBitmap = async () => ({ close() {} });
globalThis.OffscreenCanvas = class {
    constructor(width) { this.width = width; }
    getContext() { return { save() {}, restore() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, drawImage() {}, getImageData: () => ({ width: this.width }) }; }
};
const { actors, assign, actorBadge, captureActor } = await import('../lib/actorRuntime.js');
const agent = { kind: 'agent', provider: 'OpenAI', name: 'Codex', conversation_source: 'codex_sessions', conversation_id: 'codex:toolbar-test' };

test('tab-specific pointer toggles without changing historical actor or parent', async () => {
    const at = Date.now();
    const declared = await assign(1, agent, 'controller_declared', { at, expires_at: at + 60000, controller: 'test' });
    await assign(2, { kind: 'human' }, 'manual', { at });
    await actorBadge(3); // ordinary tab uses the human default and a clean icon
    const before = await actors.history(1);
    // Repeated active-tab refreshes use per-tab presentation, not a global actor.
    for (const tabId of [2, 1, 3, 1, 2]) await actorBadge(tabId);
    assert.ok(icons.get(1).imageData[16]);
    assert.equal(icons.get(2).path[16], 'icons/toolbar-16.png');
    assert.equal(icons.get(3).path[16], 'icons/toolbar-16.png');
    assert.deepEqual([...badges.values()], ['', '', '']);
    assert.equal(titles.get(1), 'TOPOS · Codex (OpenAI)');
    assert.equal((await captureActor(3)).kind, 'human');
    assert.equal((await captureActor(3)).method, 'default_human');
    assert.equal(titles.get(3), 'TOPOS · You');
    assert.deepEqual(await actors.history(1), before);
    assert.equal(loads, 8); // cached across tabs and switches
    await actors.end(1, declared.session_id, 'test');
    await actorBadge(1);
    assert.ok(icons.get(1).path);
    assert.equal((await actors.snapshot(1, {}, at)).conversation_id, agent.conversation_id);
    assert.equal((await actors.snapshot(1)).kind, 'human');
});

test('expired lease and newer human presentation cannot retain an agent cursor', async () => {
    await assign(4, agent, 'controller_declared', { at: 1, expires_at: 2 });
    await actorBadge(4);
    assert.ok(icons.get(4).path);
    await Promise.all([actorBadge(5, agent), actorBadge(5, { kind: 'human' })]);
    assert.ok(icons.get(5).path);
    assert.equal(badges.get(5), '');
    assert.equal(titles.get(5), 'TOPOS · You');
    await chrome.storage.local.set({ dialoguesConnectionExpired: true });
    await actorBadge(5, { kind: 'human' });
    assert.equal(badges.get(5), '!');
    assert.ok(icons.get(5).path);
});

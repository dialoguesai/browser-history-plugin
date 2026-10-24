import test from 'node:test';
import assert from 'node:assert/strict';
import { ActorStore, UNKNOWN_ACTOR, validateActor, resolveActor, parseAgentGroup } from '../lib/actor.js';
import { PendingActivity } from '../lib/pendingActivity.js';

export function memoryStorage() {
    const data = {};
    return {
        async get(keys) { const out = keys == null ? data : typeof keys === 'string' ? { [keys]: data[keys] } : Array.isArray(keys) ? Object.fromEntries(keys.map(k => [k, data[k]])) : { ...keys, ...Object.fromEntries(Object.keys(keys).filter(k => k in data).map(k => [k, data[k]])) }; return structuredClone(out); },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const key of [].concat(keys)) delete data[key]; }
    };
}
const identity = { kind: 'agent', name: 'Codex', provider: 'openai', conversation_source: 'codex_sessions', conversation_id: 'codex:conversation-1' };

test('agent requires source-scoped conversation identity', () => {
    assert.throws(() => validateActor({ kind: 'agent', provider: 'openai' }), /conversation/);
    assert.equal(validateActor(identity).conversation_id, identity.conversation_id);
    assert.equal(resolveActor([], 100, { webdriver: false, is_trusted: true }).kind, 'unknown');
    assert.equal(resolveActor([], 100, { webdriver: true }).kind, 'automation');
    assert.equal(resolveActor([], 100, { is_trusted: false }).kind, 'automation');
});

test('event-time snapshots survive worker restart and handoff, isolated per tab', async () => {
    const storage = memoryStorage(); const store = new ActorStore(storage);
    await store.set(1, validateActor(identity), { at: 10 });
    await store.set(1, validateActor({ kind: 'human' }), { at: 20 });
    const restarted = new ActorStore(storage);
    assert.equal((await restarted.snapshot(1, {}, 15)).name, 'Codex');
    assert.equal((await restarted.snapshot(1, {}, 25)).kind, 'human');
    assert.equal((await restarted.snapshot(2, {}, 25)).kind, 'unknown');
    assert.equal((await restarted.snapshot(1, { webdriver: true }, 25)).kind, 'automation');
    await restarted.remove(1);
    assert.equal((await restarted.snapshot(1)).kind, 'unknown');
});

test('controller leases expire to unknown; stale end cannot clear a new controller', async () => {
    const store = new ActorStore(memoryStorage());
    const first = await store.set(1, validateActor(identity), { at: 1, expires_at: 5, controller: 'a' });
    assert.equal((await store.snapshot(1, {}, 6)).kind, 'unknown');
    await store.set(1, validateActor(identity), { at: 7, controller: 'b' });
    await assert.rejects(store.end(1, first.session_id, 'a'), /no longer owns/);
    assert.equal((await store.snapshot(1, {}, 8)).kind, 'agent');
});

test('browser tab replacement preserves session, historical handoffs and lease', async () => {
    const store = new ActorStore(memoryStorage());
    await store.set(1, validateActor({ kind: 'human' }), { at: 1 });
    const agent = await store.set(1, validateActor(identity), { at: 5, expires_at: 20, controller: 'a' });
    await store.replaceTab(2, 1);
    assert.equal((await store.snapshot(2, {}, 3)).kind, 'human');
    assert.equal((await store.snapshot(2, {}, 10)).session_id, agent.session_id);
    assert.equal((await store.snapshot(2, {}, 21)).kind, 'unknown');
    assert.equal((await store.snapshot(1, {}, 10)).kind, 'unknown');
    await store.set(3, validateActor({ kind: 'human' }), { at: 7 });
    await store.replaceTab(3, 2);
    assert.equal((await store.snapshot(3, {}, 10)).kind, 'human');
});

test('explicit tab-group declarations carry identity, ordinary group names do not', () => {
    assert.equal(parseAgentGroup('🔎 Attribution probe'), null);
    const title = '[TOPOS AI] ' + ['Codex', 'openai', 'codex_sessions', 'codex:chat | 1'].map(encodeURIComponent).join(' | ');
    assert.equal(parseAgentGroup(title).conversation_id, 'codex:chat | 1');
    assert.equal(parseAgentGroup('[TOPOS AI] incomplete'), null);
});

test('bounded follow-up fills only pending activity in the same tab/document', async () => {
    const storage = memoryStorage(); let now = 100; const sent = [];
    let queue = new PendingActivity(storage, async item => { sent.push(item); return { topos: { sent: true } }; }, { holdMs: 50, now: () => now });
    const item = (id, tab) => ({ sourceId: 'browser_visits', documentId: 'doc1', record: { capture_id: id, tab_id: tab, visited_at: 'time', actor: { ...UNKNOWN_ACTOR } } });
    await queue.add(item('a', 1)); await queue.add(item('b', 2));
    await queue.resolve(1, validateActor(identity), 'wrong-doc');
    assert.equal((await storage.get('pendingActivity:a'))['pendingActivity:a'].record.actor.kind, 'unknown');
    await queue.resolve(1, validateActor(identity), 'doc1');
    now = 151;
    queue = new PendingActivity(storage, async i => { sent.push(i); return { topos: { sent: true } }; }, { now: () => now });
    await queue.resolve(2, validateActor(identity)); // too late: retain unknown
    await queue.flush();
    assert.equal(sent[0].record.actor.method, 'followup');
    assert.equal(sent[0].record.actor.conversation_id, identity.conversation_id);
    assert.equal(sent[1].record.actor.kind, 'unknown');
    assert.deepEqual(await storage.get(null), {});
});

test('outbox retries retain a stable capture id', async () => {
    const storage = memoryStorage(); let fail = true; const seen = [];
    const queue = new PendingActivity(storage, async item => { seen.push(item.record.capture_id); return { topos: { sent: !fail, reason: 'network_error' } }; }, { holdMs: 0 });
    await queue.add({ record: { capture_id: 'stable', actor: UNKNOWN_ACTOR } });
    await queue.flush(); fail = false; await queue.flush();
    assert.deepEqual(seen, ['stable', 'stable']);
    assert.deepEqual(await storage.get(null), {});
});

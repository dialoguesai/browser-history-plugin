import test from 'node:test';
import assert from 'node:assert/strict';

const memory = () => {
  const data = {};
  return { async get(keys) { return structuredClone(keys == null ? data : typeof keys === 'string' ? { [keys]: data[keys] } : Object.fromEntries(keys.map(k => [k, data[k]]))); }, async set(v) { Object.assign(data, structuredClone(v)); }, async remove(k) { delete data[k]; } };
};
const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); } });
let title = '', clock = 100;
const realNow = Date.now;
Date.now = () => clock;
globalThis.chrome = {
  storage: { session: memory(), local: memory(), sync: memory() },
  runtime: { id: 'plugin', getURL: path => `chrome-extension://plugin/${path}`, onMessageExternal: event() },
  tabs: { get: async id => ({ id, groupId: 1 }), query: async () => [{ id: 1 }], onCreated: event(), onRemoved: event(), onUpdated: event(), onReplaced: event() },
  tabGroups: { get: async () => ({ id: 1, title }), onUpdated: event(), onRemoved: event() },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} }
};
const { captureActor, observeGroup, handleActorMessage, handleExternalActorMessage } = await import('../lib/actorRuntime.js');
const ui = { id: 'plugin', url: 'chrome-extension://plugin/controller.html' };
const agent = { kind: 'agent', provider: 'openai', name: 'Codex', conversation_source: 'codex_sessions', conversation_id: 'codex:test' };

test('web content and unapproved controllers cannot assert an identity', async () => {
  await assert.rejects(handleActorMessage({ type: 'ACTOR_SET', tab_id: 1, actor: agent }, { id: 'plugin', url: 'https://example.com', tab: { id: 1 } }), /Only extension/);
  await assert.rejects(handleExternalActorMessage({ type: 'topos.actor.begin', actor: agent, tab_id: 1 }, { id: 'unapproved' }), /not approved/);
  await assert.rejects(handleActorMessage({ type: 'AUTOMATION_HINT', webdriver: true }, { id: 'plugin', frameId: 1, tab: { id: 1 } }), /Invalid/);
});

test('group observation never rewrites an earlier event; removal and human handoff work', async () => {
  title = '[TOPOS AI] ' + ['Codex', 'openai', 'codex_sessions', 'codex:test'].map(encodeURIComponent).join(' | ');
  await observeGroup(1);
  assert.equal((await captureActor(1, {}, 99)).kind, 'human');
  assert.equal((await captureActor(1, {}, 101)).conversation_id, 'codex:test');
  clock = 200;
  title = 'Ordinary human-editable title';
  await observeGroup(1);
  assert.equal((await captureActor(1, {}, 150)).kind, 'agent');
  assert.equal((await captureActor(1, {}, 201)).kind, 'human');
  title = '[TOPOS AI] ' + ['Codex', 'openai', 'codex_sessions', 'codex:new'].map(encodeURIComponent).join(' | ');
  clock = 300;
  await observeGroup(1);
  await handleActorMessage({ type: 'ACTOR_SET', tab_id: 1, actor: { kind: 'human' } }, ui);
  assert.equal((await captureActor(1, {}, 301)).kind, 'human');
  assert.equal((await captureActor(1, { webdriver: true }, 301)).kind, 'automation');
});

test('approved external integration needs a parent and can end only its own session', async () => {
  const id = 'a'.repeat(32);
  await handleActorMessage({ type: 'ACTOR_CONTROLLERS', controllers: [id], groupNames: [] }, ui);
  const result = await handleExternalActorMessage({ type: 'topos.actor.begin', actor: agent, tab_id: 2 }, { id });
  assert.equal((await captureActor(2)).kind, 'agent');
  await assert.rejects(handleExternalActorMessage({ type: 'topos.actor.end', session_id: 'wrong', tab_id: 2 }, { id }), /no longer owns/);
  await handleExternalActorMessage({ type: 'topos.actor.end', session_id: result.actor.session_id, tab_id: 2 }, { id });
  // No page can use the external API, even if it supplies an allowlisted ID.
  await assert.rejects(handleExternalActorMessage({ type: 'topos.actor.begin', actor: agent, tab_id: 2 }, { id, url: 'https://example.com' }), /not approved/);
  Date.now = realNow;
});

test('browser replacement event keeps the named parent on the new tab', async () => {
  title = '';
  const before = await handleActorMessage({ type: 'ACTOR_SET', tab_id: 40, actor: agent }, ui);
  chrome.tabs.onReplaced.listeners[0](41, 40);
  const after = await captureActor(41);
  assert.equal(after.kind, 'agent');
  assert.equal(after.session_id, before.actor.session_id);
  assert.equal(after.conversation_id, 'codex:test');
  assert.equal((await captureActor(40)).kind, 'human');
});

test('automation group hints still override the human default on an unassigned tab', async () => {
  title = 'Agent research';
  await handleActorMessage({ type: 'ACTOR_CONTROLLERS', controllers: [], groupNames: [title] }, ui);
  await observeGroup(50);
  assert.equal((await captureActor(50)).kind, 'automation');
});

import test from 'node:test';
import assert from 'node:assert/strict';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
function memory(seed = {}) {
    const data = structuredClone(seed);
    return {
        async get(keys, callback) {
            const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            const result = { ...(keys && !Array.isArray(keys) && typeof keys === 'object' ? keys : {}), ...Object.fromEntries(names.filter(k => k in data).map(k => [k, structuredClone(data[k])])) };
            callback?.(result); return result;
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const key of [].concat(keys)) delete data[key]; }
    };
}

test('content activity sends the local device name, ignoring stale synchronized names', async () => {
    const local = memory({ installationStorageVersion: 1, device_name: 'Work computer', dialoguesToken: 'test-grant', dialoguesResourceId: 'test-resource' });
    const sync = memory({ device_name: 'Old shared name', redirectSetupDone: true, dialoguesControlPlaneUrl: 'https://cp.logu3s.com' });
    const tab = { id: 42, url: 'https://example.test/', groupId: -1 };
    globalThis.chrome = {
        storage: { local, sync, session: memory(), onChanged: event() },
        runtime: { id: 'plugin', getURL: p => `chrome-extension://plugin/${p}`, onMessage: event(), onMessageExternal: event(), onInstalled: event() },
        tabs: { get: async () => tab, query: async () => [tab], onUpdated: event(), onCreated: event(), onRemoved: event(), onReplaced: event(), onActivated: event() },
        action: { setIcon: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
        alarms: { create() {}, onAlarm: event() },
        webNavigation: { onBeforeNavigate: event(), onCompleted: event() },
        contextMenus: { onClicked: event() }
    };
    const writes = [];
    globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://cp.logu3s.com/v1/ingestion/app_ingest');
        writes.push(JSON.parse(options.body));
        return new Response('{}', { status: 200 });
    };
    await import('../background.js');
    const send = () => new Promise(resolve => {
        chrome.runtime.onMessage.listeners[0]({ type: 'click', url: tab.url, visited_at: new Date().toISOString(), device_name: 'Old shared name', content: { text: 'Example' } }, { id: 'plugin', tab, frameId: 0 }, resolve);
    });
    assert.deepEqual(await send(), { ok: true });
    assert.equal(writes[0].source_id, 'browser_events');
    assert.equal(writes[0].records[0].device_name, 'Work computer');
    assert.equal(writes[0].records[0].tab_id, 42);
    await local.set({ device_name: '' });
    assert.deepEqual(await send(), { ok: true });
    assert.equal(writes[1].records[0].device_name, '');
    assert.equal((await sync.get('device_name')).device_name, 'Old shared name');
});

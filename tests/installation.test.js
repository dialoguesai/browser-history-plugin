import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallationStorage, getInstallationId } from '../lib/installationStorage.js';
import { buildGrantConnectUrl } from '../lib/grantAccess.js';

function memory(seed = {}) {
    const data = structuredClone(seed);
    return {
        async get(keys) {
            if (typeof keys === 'string') return { [keys]: data[keys] };
            return { ...(Array.isArray(keys) ? {} : keys), ...Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(keys)).filter(k => k in data).map(k => [k, data[k]])) };
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
    };
}

test('migration preserves attachment once, then device names and grants stay independent', async () => {
    const sync = memory({ device_name: 'Old laptop', dialoguesToken: 'legacy-grant', dialoguesResourceId: 'resource' });
    const a = createInstallationStorage({ local: memory(), sync });
    const b = createInstallationStorage({ local: memory(), sync });
    assert.equal((await a.get('dialoguesToken')).dialoguesToken, 'legacy-grant');
    assert.equal((await b.get('dialoguesToken')).dialoguesToken, 'legacy-grant');
    await a.set({ device_name: 'Personal computer', dialoguesToken: 'personal-grant' });
    await b.set({ device_name: 'Work computer', dialoguesToken: 'work-grant' });
    await sync.set({ device_name: 'Synced old client', dialoguesToken: 'synced-grant' });
    assert.deepEqual(await a.get(['device_name', 'dialoguesToken']), { device_name: 'Personal computer', dialoguesToken: 'personal-grant' });
    assert.deepEqual(await b.get(['device_name', 'dialoguesToken']), { device_name: 'Work computer', dialoguesToken: 'work-grant' });
    await a.remove('dialoguesToken');
    assert.equal((await a.get('dialoguesToken')).dialoguesToken, undefined);
    assert.equal((await b.get('dialoguesToken')).dialoguesToken, 'work-grant');
});

test('local settings win migration, including an intentionally blank device name', async () => {
    const local = memory({ device_name: '', dialoguesToken: 'local-grant' });
    const sync = memory({ device_name: 'Old computer', dialoguesToken: 'old-grant' });
    const storage = createInstallationStorage({ local, sync });
    assert.deepEqual(await storage.get(['device_name', 'dialoguesToken']), { device_name: '', dialoguesToken: 'local-grant' });
    const restarted = createInstallationStorage({ local, sync });
    await storage.remove('dialoguesToken');
    assert.equal((await restarted.get('dialoguesToken')).dialoguesToken, undefined);
});

test('attach state binds the local installation with fresh crypto nonce and PKCE each time', async () => {
    const local = memory(), sync = memory();
    globalThis.chrome = { storage: { local, sync }, runtime: { getURL: () => 'chrome-extension://' + 'a'.repeat(32) + '/options.html' } };
    const first = await buildGrantConnectUrl('https://cp.example.test');
    const second = await buildGrantConnectUrl('https://cp.example.test');
    assert.notEqual(first.pendingState, second.pendingState);
    assert.notEqual(first.codeVerifier, second.codeVerifier);
    const id = await getInstallationId();
    assert.equal(first.pendingState.split('.')[1], id);
    assert.equal(second.pendingState.split('.')[1], id);
    assert.equal((await sync.get('browserInstallationId')).browserInstallationId, undefined);
    const original = id;
    chrome.storage = { local: memory(), sync };
    assert.notEqual(await getInstallationId(), original);
});

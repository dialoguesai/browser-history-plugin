import test from 'node:test';
import assert from 'node:assert/strict';
import { redirectUrisForThisInstall, registerInstallRedirects } from '../lib/registerRedirect.js';
import { getGrantRedirectUri, exchangeGrantCode } from '../lib/grantAccess.js';

test('Safari registers its exact runtime URL origin, never its bundle ID or a chromiumapp URL', async () => {
    const url = 'safari-web-extension://12345678-ABCD-1234-ABCD-123456789ABC/options.html';
    globalThis.chrome = { runtime: { id: 'com.example.bundle', getURL: () => url }, storage: { sync: { get: async () => ({}) } }, identity: { getRedirectURL: () => 'https://wrong.chromiumapp.org/' } };
    assert.equal(getGrantRedirectUri(), url);
    assert.equal(redirectUrisForThisInstall().extensionId, '12345678-abcd-1234-abcd-123456789abc');
    const realFetch = globalThis.fetch;
    let sent;
    globalThis.fetch = async (_url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ redirect_uris: [url] }) }; };
    try { await registerInstallRedirects('https://cp.example.test'); } finally { globalThis.fetch = realFetch; }
    assert.deepEqual(sent, { extension_id: '12345678-abcd-1234-abcd-123456789abc', browser: 'safari', redirect_uri: url });
});

test('Chrome retains its existing identity callback; missing/mismatched OAuth state is rejected before exchange', async () => {
    globalThis.chrome = { runtime: { id: 'a'.repeat(32), getURL: p => 'chrome-extension://' + 'a'.repeat(32) + '/' + p }, identity: { getRedirectURL: () => 'https://' + 'a'.repeat(32) + '.chromiumapp.org/' } };
    assert.equal(redirectUrisForThisInstall().browser, 'chrome');
    assert.equal(getGrantRedirectUri(), 'https://' + 'a'.repeat(32) + '.chromiumapp.org/');
    await assert.rejects(exchangeGrantCode({ stateFromUrl: 'wrong', expectedState: 'expected' }), /state mismatch/);
    await assert.rejects(exchangeGrantCode({ stateFromUrl: '', expectedState: '' }), /state mismatch/);
});

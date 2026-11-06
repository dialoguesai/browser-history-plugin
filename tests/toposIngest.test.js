import test from 'node:test';
import assert from 'node:assert/strict';

// protects: with a local key the extension posts ONE batch to the node's loopback door with a write_id that is
// the same for the same records (the node dedupes on it); a 401 drops the key, a 403 (not this app's source)
// and a 4xx (bad batch) are not retried, 5xx and network trouble are; without a local key the account path is
// byte-for-byte what it was; with neither the record waits (`not_attached`).

function memory(seed = {}) {
    const data = structuredClone(seed);
    return {
        async get(keys) {
            const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            return { ...(keys && !Array.isArray(keys) && typeof keys === 'object' ? keys : {}), ...Object.fromEntries(names.filter(k => k in data).map(k => [k, structuredClone(data[k])])) };
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
        data
    };
}

const LOCAL_KEY = 'tpw_browser-history-plugin.' + 'ab'.repeat(20);
const ORIGIN = 'chrome-extension://' + 'a'.repeat(32);
let local;
let calls;

function arm(seed) {
    local = memory({ installationStorageVersion: 1, ...seed });
    globalThis.chrome = {
        storage: { local, sync: memory(), session: memory() },
        runtime: { id: 'a'.repeat(32), getURL: p => `${ORIGIN}/${p}` }
    };
    calls = [];
}

function answer(status, body) {
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };
}

const { sendToTopos, localWriteId, getToposTarget, probeLocalTopos, DEFAULT_LOCAL_TOPOS_URL } = await import('../lib/toposIngest.js');
const { PendingActivity } = await import('../lib/pendingActivity.js');

const visit = (i) => ({ url: `https://example.test/${i}`, visited_at: `2026-11-05T10:0${i}:00.000Z`, capture_id: `cap-${i}` });

test('a local key sends one batch to the node door with a stable write_id and the key as bearer', async () => {
    arm({ toposLocalKey: LOCAL_KEY, dialoguesToken: 'grant', dialoguesResourceId: 'res' });
    answer(200, { status: 'ok', write_id: 'ignored-by-test', records_processed: 2, records_total: 2, errors: [], deduplicated: false });
    const result = await sendToTopos('browser_visits', [visit(1), visit(2)]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${DEFAULT_LOCAL_TOPOS_URL}/sources/browser_visits/ingest/batch`);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.Authorization, `Bearer ${LOCAL_KEY}`);
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['records', 'write_id']);
    assert.equal(calls[0].body.records.length, 2);
    assert.equal(calls[0].body.write_id, localWriteId('browser_visits', [visit(1), visit(2)]));
    assert.equal(result.sent, true);
    assert.equal(result.target, 'local');
    assert.equal(result.deduplicated, false);
    // The same records again carry the same id; different records a different one.
    assert.equal(localWriteId('browser_visits', [visit(1), visit(2)]), 'browser_visits:cap-1|cap-2');
    assert.notEqual(localWriteId('browser_visits', [visit(3)]), localWriteId('browser_visits', [visit(1)]));
    assert.equal(localWriteId('browser_events', [{ url: 'https://x.test/', starred_at: 't1' }]), 'browser_events:https://x.test/@t1');
    // The local key wins over an account grant that is also present.
    assert.equal((await getToposTarget()).mode, 'local');
});

test('a configured node address is used, trailing slash and all', async () => {
    arm({ toposLocalKey: LOCAL_KEY, toposLocalUrl: 'http://127.0.0.1:9100/' });
    answer(200, { status: 'ok', write_id: 'w', records_processed: 1, records_total: 1, errors: [], deduplicated: true });
    const result = await sendToTopos('browser_events', [visit(1)]);
    assert.equal(calls[0].url, 'http://127.0.0.1:9100/sources/browser_events/ingest/batch');
    assert.equal(result.sent, true);
    assert.equal(result.deduplicated, true);
});

test('a 401 from the node drops the key so the badge can say so; a 403 keeps it and is final', async () => {
    arm({ toposLocalKey: LOCAL_KEY });
    answer(401, { detail: { error: 'pusher_key_refused', message: 'disconnected' } });
    const expired = await sendToTopos('browser_visits', [visit(1)]);
    assert.deepEqual([expired.sent, expired.reason, expired.target, expired.status], [false, 'auth_expired', 'local', 401]);
    assert.equal(local.data.toposLocalKey, undefined);
    assert.equal((await getToposTarget()).mode, 'none');

    arm({ toposLocalKey: LOCAL_KEY });
    answer(403, { status: 'error', error: 'source_not_allowed', message: "Source 'browser_events' is not one 'browser-history-plugin' may write" });
    const refused = await sendToTopos('browser_events', [visit(1)]);
    assert.deepEqual([refused.sent, refused.reason, refused.status], [false, 'refused', 403]);
    assert.match(refused.body, /browser_events/);
    assert.equal(local.data.toposLocalKey, LOCAL_KEY);
});

test('a bad batch is rejected for good; node trouble and the network are retried', async () => {
    arm({ toposLocalKey: LOCAL_KEY });
    answer(422, { status: 'error', error: 'all_records_failed', message: 'All 1 record(s) failed' });
    const rejected = await sendToTopos('browser_visits', [{ title: 'no url' }]);
    assert.deepEqual([rejected.sent, rejected.reason, rejected.status], [false, 'rejected', 422]);
    answer(503, 'busy');
    assert.equal((await sendToTopos('browser_visits', [visit(1)])).reason, 'engine_or_server_error');
    answer(409, { error: 'not_paired' });
    assert.equal((await sendToTopos('browser_visits', [visit(1)])).reason, 'engine_or_server_error');
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const down = await sendToTopos('browser_visits', [visit(1)]);
    assert.deepEqual([down.sent, down.reason, down.target], [false, 'network_error', 'local']);
    assert.equal(local.data.toposLocalKey, LOCAL_KEY);
});

test('the outbox retries node trouble but not a refusal or a rejected batch', async () => {
    const outcomes = { refused: 'refused', rejected: 'rejected', engine_or_server_error: 'engine_or_server_error', network_error: 'network_error' };
    for (const [reason, expected] of Object.entries(outcomes)) {
        const store = memory();
        let now = 1000;
        const pending = new PendingActivity(store, async () => ({ topos: { sent: false, reason: expected } }), { holdMs: 0, now: () => now });
        await pending.add({ sourceId: 'browser_visits', record: { capture_id: reason, tab_id: 1, actor: { kind: 'human' } } });
        now += 1;
        await pending.flush();
        const kept = Object.keys(store.data).some(k => k.startsWith('pendingActivity:'));
        assert.equal(kept, ['engine_or_server_error', 'network_error'].includes(reason), `${reason} kept=${kept}`);
    }
});

test('without a local key the account path is unchanged', async () => {
    arm({ dialoguesToken: 'grant', dialoguesResourceId: 'res', dialoguesControlPlaneUrl: 'https://cp.logu3s.com' });
    answer(200, {});
    const result = await sendToTopos('browser_visits', [visit(1)]);
    assert.equal(calls[0].url, 'https://cp.logu3s.com/v1/ingestion/app_ingest');
    assert.equal(calls[0].headers.Authorization, 'Bearer grant');
    assert.deepEqual(calls[0].body, { resource_id: 'res', source_id: 'browser_visits', records: [visit(1)] });
    assert.deepEqual(result, { sent: true, target: 'account', status: 200 });
    assert.equal((await getToposTarget()).mode, 'account');
    answer(401, 'expired');
    const expired = await sendToTopos('browser_visits', [visit(1)]);
    assert.equal(expired.reason, 'auth_expired');
    assert.equal(local.data.dialoguesToken, undefined);
});

test('with neither target the record waits', async () => {
    arm({});
    globalThis.fetch = async () => { throw new Error('must not be called'); };
    assert.deepEqual(await sendToTopos('browser_visits', [visit(1)]), { sent: false, reason: 'not_attached' });
});

test('probing a key asks the node and surfaces its refusal', async () => {
    arm({});
    answer(200, { status: 'ok', app: 'browser-history-plugin', owner: false, sources: ['browser_visits', 'browser_events'], origins: [ORIGIN] });
    const me = await probeLocalTopos('http://127.0.0.1:8676/', LOCAL_KEY);
    assert.equal(calls[0].url, 'http://127.0.0.1:8676/local-pushers/me');
    assert.equal(calls[0].headers.Authorization, `Bearer ${LOCAL_KEY}`);
    assert.deepEqual(me.sources, ['browser_visits', 'browser_events']);
    answer(401, { detail: { error: 'pusher_key_refused', message: "This app's key is not one this Topos issued, or the app was disconnected." } });
    await assert.rejects(probeLocalTopos('http://127.0.0.1:8676', LOCAL_KEY), /not one this Topos issued/);
    await assert.rejects(probeLocalTopos('http://127.0.0.1:8676', 'tpk_not-a-pusher.x'), /should start with tpw_/);
    assert.equal(local.data.toposLocalKey, undefined);
});

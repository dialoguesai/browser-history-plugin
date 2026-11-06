import { installationStorage } from './installationStorage.js';
import { getControlPlaneUrl } from './config.js';

/**
 * Two ways into a Topos, one at a time.
 *
 * - **Local node (no account).** The owner ran `topos-node pushers add browser-history-plugin …` on their
 *   computer and pasted the key it printed into Options → Topos. Records go straight to the node's loopback
 *   door, `POST /sources/{source_id}/ingest/batch` on `http://127.0.0.1:8676`, as one batch with a stable
 *   `write_id`, so a retry after a dropped reply writes nothing twice (the node answers `deduplicated`).
 *   The node does the checks the control plane does on the account path: the key names this app, the
 *   sources it may write were named by the owner, and CORS answers only this extension's own origin.
 * - **Account (control plane).** Attach Dialogues issued a grant token; records go to
 *   `/v1/ingestion/app_ingest` as before.
 *
 * A local key wins when both are present: it was placed deliberately on this computer.
 */
export const DEFAULT_LOCAL_TOPOS_URL = 'http://127.0.0.1:8676';
export const LOCAL_KEY_PREFIX = 'tpw_';

function isEngineResponseTimeout(status, bodyText) {
    if (status !== 504) return false;
    const text = String(bodyText || '').toLowerCase();
    return text.includes('engine response timeout');
}

function trimSlash(url) {
    return String(url || '').trim().replace(/\/$/, '');
}

/** The one identity of a record for dedupe: its capture id, else what it is about and when. */
function recordKey(record) {
    if (record?.capture_id) return String(record.capture_id);
    const when = record?.visited_at || record?.starred_at || record?.created_at || '';
    return `${record?.url || ''}@${when}`;
}

/** Stable across retries of the same records, distinct for different ones; what the node dedupes on. */
export function localWriteId(sourceId, records) {
    return `${sourceId}:${(records || []).map(recordKey).join('|')}`.slice(0, 512);
}

export async function getToposTarget() {
    const stored = await installationStorage.get({
        toposLocalKey: '',
        toposLocalUrl: '',
        dialoguesToken: '',
        dialoguesResourceId: '',
        dialoguesControlPlaneUrl: ''
    });
    if (stored.toposLocalKey) {
        return { mode: 'local', url: trimSlash(stored.toposLocalUrl) || DEFAULT_LOCAL_TOPOS_URL, key: stored.toposLocalKey };
    }
    const controlPlaneUrl = trimSlash(stored.dialoguesControlPlaneUrl || getControlPlaneUrl());
    if (stored.dialoguesToken && stored.dialoguesResourceId && controlPlaneUrl) {
        return { mode: 'account', url: controlPlaneUrl, token: stored.dialoguesToken, resourceId: stored.dialoguesResourceId };
    }
    return { mode: 'none' };
}

/**
 * Ask a local node what a key is good for (`GET /local-pushers/me`). Resolves the node's answer
 * (`{app, sources, origins}`) or throws with the node's refusal; nothing is stored here.
 */
export async function probeLocalTopos(url, key) {
    const base = trimSlash(url) || DEFAULT_LOCAL_TOPOS_URL;
    const trimmedKey = String(key || '').trim();
    if (!trimmedKey.startsWith(LOCAL_KEY_PREFIX)) throw new Error(`The key should start with ${LOCAL_KEY_PREFIX}`);
    const response = await fetch(`${base}/local-pushers/me`, { headers: { Authorization: `Bearer ${trimmedKey}` } });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!response.ok) {
        const detail = body?.detail?.message || body?.detail?.error || body?.message || body?.error || text || `HTTP ${response.status}`;
        throw Object.assign(new Error(detail), { status: response.status });
    }
    return body;
}

async function sendToLocalNode(target, sourceId, records) {
    const url = `${target.url}/sources/${encodeURIComponent(sourceId)}/ingest/batch`;
    const write_id = localWriteId(sourceId, records);
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.key}` },
            body: JSON.stringify({ records, write_id })
        });
    } catch (err) {
        return { sent: false, reason: 'network_error', target: 'local', error: err };
    }
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (response.status === 401) {
        // The node no longer knows this key (disconnected, or another node). Drop it so the badge says so.
        await installationStorage.remove(['toposLocalKey']);
        return { sent: false, reason: 'auth_expired', target: 'local', status: 401, body: text };
    }
    if (response.status === 403) {
        // Not this app's source, or not this computer: the owner's allowlist decides, a retry would not.
        return { sent: false, reason: 'refused', target: 'local', status: 403, body: body?.message || body?.detail?.message || text };
    }
    if (response.ok) {
        return { sent: true, target: 'local', status: response.status, write_id: body.write_id || write_id,
            deduplicated: body.deduplicated === true, records_processed: body.records_processed };
    }
    if (response.status === 409 || response.status >= 500) {
        return { sent: false, reason: 'engine_or_server_error', target: 'local', status: response.status, body: text };
    }
    // 400, 404, 413, 422: the batch itself is wrong; sending it again would be wrong again.
    return { sent: false, reason: 'rejected', target: 'local', status: response.status, body: body?.message || text };
}

async function sendToControlPlane(target, sourceId, records) {
    const appIngestUrl = `${target.url}/v1/ingestion/app_ingest`;
    try {
        const response = await fetch(appIngestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${target.token}`
            },
            body: JSON.stringify({
                resource_id: target.resourceId,
                source_id: sourceId,
                records
            })
        });
        if (response.status === 401 || response.status === 403) {
            const errorBody = await response.text();
            await installationStorage.remove(['dialoguesToken', 'dialoguesResourceId']);
            return { sent: false, reason: 'auth_expired', target: 'account', status: response.status, body: errorBody };
        }
        if (response.status === 202) {
            let body = {};
            try {
                body = await response.json();
            } catch (_err) {
                body = {};
            }
            return {
                sent: true,
                target: 'account',
                queued: true,
                write_id: body.write_id || null,
                status: response.status,
            };
        }
        if (response.status === 502 || response.status === 503 || !response.ok) {
            const errorText = await response.text();
            // CP timed out waiting for engine ack, but the write often still lands on the node.
            if (isEngineResponseTimeout(response.status, errorText)) {
                return {
                    sent: true,
                    target: 'account',
                    in_flight: true,
                    status: response.status,
                    body: errorText
                };
            }
            return { sent: false, reason: 'engine_or_server_error', target: 'account', status: response.status, body: errorText };
        }
        return { sent: true, target: 'account', status: response.status };
    } catch (err) {
        return { sent: false, reason: 'network_error', target: 'account', error: err };
    }
}

export async function sendToTopos(sourceId, records) {
    const target = await getToposTarget();
    if (target.mode === 'local') return sendToLocalNode(target, sourceId, records);
    if (target.mode === 'account') return sendToControlPlane(target, sourceId, records);
    return { sent: false, reason: 'not_attached' };
}

// Cooperative local-agent handoff. No identity is accepted from a web page.
// The local agent creates a short-lived, single-claim capability and opens it in
// the tab it will control. Identity is fetched by the extension from loopback.
import { actors, assign, actorBadge, resolvePendingActor } from './actorRuntime.js';

export const BRIDGE_PATH = '/.well-known/topos-agent/v1/';
export function bridgeLocation(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search) return null;
        const action = url.pathname.slice(BRIDGE_PATH.length);
        if (!url.pathname.startsWith(BRIDGE_PATH) || !['connect', 'end'].includes(action) || !/^#[a-f0-9]{64}$/.test(url.hash)) return null;
        return { origin: url.origin, action, ticket: url.hash.slice(1) };
    } catch { return null; }
}
export function isBridgePage(value) {
    try { const u = new URL(value); return u.hostname === '127.0.0.1' && u.pathname.startsWith(BRIDGE_PATH); } catch { return false; }
}
const key = tabId => `agentBridge:${tabId}`;
let tail = Promise.resolve();
async function request(origin, path, ticket, body) {
    const response = await fetch(`${origin}${BRIDGE_PATH}${path}`, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Topos-Agent-Bridge': '1', Authorization: `Bearer ${ticket}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Agent bridge refused the handoff (${response.status}).`);
    return response.json();
}

export function connectAgentTab(tabId, value) {
    let acknowledgedActor;
    const task = tail.then(async () => {
        const location = bridgeLocation(value);
        if (!location || (await chrome.tabs.get(tabId)).url !== value) return;
        let entry = (await chrome.storage.session.get(key(tabId)))[key(tabId)];
        if (location.action === 'end') {
            if (!entry || entry.origin !== location.origin || entry.release !== location.ticket) throw new Error('This handoff does not own the tab.');
            await actors.end(tabId, entry.actor.session_id, entry.controller);
            await request(entry.origin, 'ended', entry.secret, { session_id: entry.actor.session_id });
            await chrome.storage.session.remove(key(tabId));
            await actorBadge(tabId);
            return;
        }
        if (entry?.ticket !== location.ticket || entry.origin !== location.origin) {
            entry = { ...location, client_id: crypto.randomUUID() };
            await chrome.storage.session.set({ [key(tabId)]: entry });
        }
        if (!entry.actor) {
            const claim = await request(location.origin, 'claim', location.ticket, { client_id: entry.client_id });
            if (claim.protocol !== 1 || claim.actor?.kind !== 'agent' || !/^[a-f0-9]{64}$/.test(claim.secret) || !/^[a-f0-9]{64}$/.test(claim.release)) throw new Error('Invalid bridge response.');
            if (!Number.isFinite(claim.expires_at) || claim.expires_at <= Date.now() || claim.expires_at > Date.now() + 720 * 60000) throw new Error('Invalid agent lease.');
            // Navigation while claiming must never attribute a different page.
            if ((await chrome.tabs.get(tabId)).url !== value) return;
            const controller = `loopback:${entry.client_id}`;
            const actor = await assign(tabId, claim.actor, 'controller_declared', { controller, expires_at: claim.expires_at, deferPending: true });
            entry = { ...entry, actor, controller, expires_at: claim.expires_at, secret: claim.secret, release: claim.release, verify_origin: claim.verify_origin || null };
            await chrome.storage.session.set({ [key(tabId)]: entry });
        }
        if ((await actors.snapshot(tabId)).session_id !== entry.actor.session_id) {
            await request(entry.origin, 'ended', entry.secret, { session_id: entry.actor.session_id });
            await chrome.storage.session.remove(key(tabId));
            throw new Error('Agent control has ended. Start a new handoff to resume.');
        }
        await request(entry.origin, 'ack', entry.secret, { actor: entry.actor, extension_version: chrome.runtime.getManifest().version, user_agent: navigator.userAgent });
        acknowledgedActor = entry.actor;
    });
    tail = task.catch(() => {});
    // Pending delivery can call recordBridgeDelivery, which waits for tail.
    // Drain only after this handoff leaves that queue and its entry is acknowledged.
    return task.then(async () => {
        if (acknowledgedActor) await resolvePendingActor(tabId, acknowledgedActor);
    });
}

// Opt-in, local-only verification of the SAME records and serializer used by
// app_ingest. Never copy credentials, unrelated tabs, or other origins.
export async function recordBridgeDelivery(sourceId, records, delivery) {
    await tail;
    for (const record of records) {
        const entry = (await chrome.storage.session.get(key(record.tab_id)))[key(record.tab_id)];
        if (!entry?.verify_origin || Date.now() >= entry.expires_at || record.actor?.session_id !== entry.actor?.session_id) continue;
        let origin;
        try { origin = new URL(record.url).origin; } catch { continue; }
        if (origin !== entry.verify_origin) continue;
        const safeResult = { sent: delivery.sent === true, status: delivery.status || null, reason: delivery.reason || null, queued: delivery.queued === true, in_flight: delivery.in_flight === true, write_id: delivery.write_id || null };
        try { await request(entry.origin, 'receipt', entry.secret, { source_id: sourceId, records: [record], delivery: safeResult }); } catch (e) { console.warn('[AGENT_BRIDGE] Local receipt unavailable:', e.message); }
    }
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (isBridgePage(change.url || tab?.url)) connectAgentTab(tabId, change.url || tab.url).catch(e => console.warn('[AGENT_BRIDGE]', e.message));
});
chrome.tabs.onReplaced?.addListener((added, removed) => {
    const task = tail.then(async () => {
        const old = (await chrome.storage.session.get(key(removed)))[key(removed)];
        const current = (await chrome.storage.session.get(key(added)))[key(added)];
        if (old && !current) await chrome.storage.session.set({ [key(added)]: old });
        await chrome.storage.session.remove(key(removed));
    });
    tail = task.catch(() => {});
});
chrome.tabs.onRemoved.addListener(id => { const task = tail.then(() => chrome.storage.session.remove(key(id))); tail = task.catch(() => {}); });

import { installationStorage } from './lib/installationStorage.js';
console.log('[BACKGROUND] Service worker started');
import { captureActor, actorBadge, handleActorMessage, bindPending } from './lib/actorRuntime.js';
import { PendingActivity } from './lib/pendingActivity.js';
import { getControlPlaneUrl } from './lib/config.js';
import { buildSkipList, shouldSkipHostname } from './lib/skipDomains.js';
import { dispatchRecord } from './lib/dispatch.js';
import { exchangeGrantCode } from './lib/grantAccess.js';
import { resetSupabaseClient } from './lib/supabaseIngest.js';
import { registerInstallRedirects } from './lib/registerRedirect.js';
import { isBridgePage, connectAgentTab, recordBridgeDelivery } from './lib/agentBridge.js';

let skipDomains = buildSkipList([]);
/** Consecutive Topos ingest failures; badge only latches after several (success always resets). */
let toposIngestFailureStreak = 0;

function initFromStorage() {
    chrome.storage.sync.get(
        {
            supabaseUrl: '',
            anonKey: '',
            skipDomains: [],
            redirectSetupDone: false,
            dialoguesControlPlaneUrl: ''
        },
        ({ skipDomains: userDomains, redirectSetupDone, dialoguesControlPlaneUrl }) => {
            resetSupabaseClient();
            skipDomains = buildSkipList(userDomains);
            console.log('Effective skip list:', skipDomains);
            const cp = getControlPlaneUrl();
            if (cp && !dialoguesControlPlaneUrl) {
                chrome.storage.sync.set({ dialoguesControlPlaneUrl: cp });
            }
            if (cp && !redirectSetupDone) {
                registerInstallRedirects(cp)
                    .then(() =>
                        chrome.storage.sync.set({ redirectSetupDone: true, redirectSetupError: '' })
                    )
                    .catch((e) =>
                        console.warn('[BACKGROUND] Redirect registration:', e?.message || e)
                    );
            }
        }
    );
}

/** Show or hide the "connection expired" (red) badge. Only for 401/403 — user must re-attach. */
async function setDialoguesErrorBadge(show) {
    try {
        if (show) {
            await installationStorage.set({ dialoguesConnectionExpired: true });
        } else {
            await installationStorage.remove(['dialoguesConnectionExpired']);
        }
        await refreshDialoguesBadge();
    } catch (e) {
        console.warn('setDialoguesErrorBadge:', e);
    }
}

/** Show or hide the "engine unavailable" (yellow) warning badge. Does not clear token; no re-attach needed. */
async function setDialoguesEngineWarningBadge(show) {
    try {
        if (show) {
            await installationStorage.set({ dialoguesEngineWarning: true });
        } else {
            await installationStorage.remove(['dialoguesEngineWarning']);
        }
        await refreshDialoguesBadge();
    } catch (e) {
        console.warn('setDialoguesEngineWarningBadge:', e);
    }
}

/** Apply badge from storage: red = connection expired (re-attach), yellow = engine unavailable (no re-attach). */
async function refreshDialoguesBadge() {
    try {
        if (typeof chrome.action === 'undefined') return;
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map(tab => actorBadge(tab.id)));
        const { dialoguesConnectionExpired, dialoguesEngineWarning } = await installationStorage.get({
            dialoguesConnectionExpired: false,
            dialoguesEngineWarning: false
        });
        if (dialoguesConnectionExpired) {
            await chrome.action.setBadgeText({ text: '!' });
            await chrome.action.setBadgeBackgroundColor({ color: '#c00' });
        } else if (dialoguesEngineWarning) {
            await chrome.action.setBadgeText({ text: '!' });
            await chrome.action.setBadgeBackgroundColor({ color: '#da0' });
        } else {
            await chrome.action.setBadgeText({ text: '' });
            await chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
        }
    } catch (e) {
        console.warn('refreshDialoguesBadge:', e);
    }
}

/** On load: apply stored badge state (red = re-attach, yellow = engine warning). */
async function applyStoredErrorBadge() {
    await refreshDialoguesBadge();
}

// run once on load
initFromStorage();
applyStoredErrorBadge();
// re‑run whenever options change
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') initFromStorage(); });
// When connection-expired or engine-warning is cleared, refresh badge.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const expiredCleared = 'dialoguesConnectionExpired' in changes && changes.dialoguesConnectionExpired.newValue === undefined;
    const engineWarningCleared = 'dialoguesEngineWarning' in changes && changes.dialoguesEngineWarning.newValue === undefined;
    if (expiredCleared || engineWarningCleared) {
        refreshDialoguesBadge().catch(() => {});
    }
});

async function applyToposIngestResult(result, sourceId, recordCount = 1) {
    if (!result) return;
    if (result.reason === 'not_attached') {
        // Do not leave a stale yellow badge when Topos is no longer configured.
        await setDialoguesEngineWarningBadge(false);
        return;
    }
    if (result.reason === 'auth_expired') {
        toposIngestFailureStreak = 0;
        console.warn('[APP_INGEST] Token rejected:', result.status, result.body || '');
        await setDialoguesErrorBadge(true);
        chrome.notifications?.create({
            type: 'basic',
            iconUrl: 'icons/icon-48.png',
            title: 'Dialogues Connection Expired',
            message: 'Please re-attach Dialogues in the extension options.'
        });
        return;
    }
    if (result.sent) {
        toposIngestFailureStreak = 0;
        const note = result.in_flight ? ' (accepted; engine still processing)' : '';
        console.log('[APP_INGEST] Successfully sent', sourceId, `(${recordCount} record(s))${note}`);
        // A landed send proves the connection is healthy, so clear BOTH error
        // badges. Without clearing the red (connection-expired) one here it would
        // stay latched after ingests recover, until a manual re-attach.
        await setDialoguesErrorBadge(false);
        await setDialoguesEngineWarningBadge(false);
        return;
    }
    toposIngestFailureStreak += 1;
    console.warn('[APP_INGEST] Topos ingest issue:', sourceId, result);
    // Ignore one-off races (nav success + click failure); latch only after repeated failures.
    if (toposIngestFailureStreak >= 3) {
        await setDialoguesEngineWarningBadge(true);
    }
}

async function ingestRecord({ sourceId, record, supabaseTable = 'browserplugin', delivered = {} }) {
    if (isBridgePage(record.url)) return { topos: { sent: false, reason: 'not_attached' } };
    if (record.device_name == null || record.device_name === '') {
        const { device_name = '' } = await installationStorage.get({ device_name: '' });
        record.device_name = device_name;
    }
    const results = await dispatchRecord({ sourceId, record, supabaseTable, delivered });
    await recordBridgeDelivery(sourceId, [record], results.topos || {});
    await applyToposIngestResult(results.topos, sourceId);
    if (results.supabase?.sent) {
        console.log('[SUPABASE] Logged', sourceId, record.url?.slice?.(0, 60));
    } else if (results.supabase?.reason === 'insert_error') {
        console.error('[SUPABASE] insert error:', results.supabase.error);
    }
    return results;
}

// Pending visits are an outbox, not a change to their event time.
const pendingActivity = new PendingActivity(chrome.storage.session, ingestRecord);
bindPending(pendingActivity);
async function queueVisit(record, documentId = null) {
    record.capture_id = crypto.randomUUID();
    record.actor = await captureActor(record.tab_id, {}, Date.parse(record.visited_at), documentId);
    await pendingActivity.add({ sourceId: 'browser_visits', record, documentId });
    await pendingActivity.resolve(record.tab_id, await captureActor(record.tab_id, {}, Date.now(), documentId), documentId);
    setTimeout(() => pendingActivity.flush().catch(console.warn), 2600);
}
chrome.alarms.create('flush-browser-activity', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'flush-browser-activity') {
        pendingActivity.flush().catch(console.warn);
        // Reuse the existing wake-up to clear cursors when controller leases end.
        chrome.tabs.query({ active: true })
            .then(tabs => Promise.all(tabs.map(tab => actorBadge(tab.id))))
            .catch(console.warn);
    }
});
pendingActivity.flush().catch(console.warn);

const processedGrantRedirectUrls = new Set();

function closeApprovalTab(tabId) {
    if (tabId == null) return;
    chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
            console.log('[BACKGROUND] Approval tab already closed:', chrome.runtime.lastError.message);
        }
        installationStorage.remove(['_approvalTabId']);
    });
}

async function exchangeGrantCodeInBackground(code, state, tabId) {
    const base = await installationStorage.get({
        _grantPendingState: '',
        _grantPkceVerifier: ''
    });
    const controlPlaneUrl = getControlPlaneUrl();
    if (!controlPlaneUrl || !base._grantPkceVerifier) {
        console.warn('[BACKGROUND] Missing Control Plane URL or PKCE verifier; cannot exchange');
        return false;
    }
    try {
        const { runToken, resourceId } = await exchangeGrantCode({
            controlPlaneUrl,
            code,
            codeVerifier: base._grantPkceVerifier,
            stateFromUrl: state,
            expectedState: base._grantPendingState
        });
        await setDialoguesErrorBadge(false);
        await setDialoguesEngineWarningBadge(false);
        await installationStorage.set({
            dialoguesToken: runToken,
            dialoguesResourceId: resourceId,
            dialoguesControlPlaneUrl: controlPlaneUrl,
            _grantQueryProcessed: true
        });
        await installationStorage.remove(['_grantPendingState', '_grantPkceVerifier']);
        console.log('[BACKGROUND] Token/resource_id stored from Grant Access exchange');
        closeApprovalTab(tabId);
        chrome.runtime.openOptionsPage?.();
        return true;
    } catch (e) {
        console.warn('[BACKGROUND] Grant exchange failed:', e?.message || e);
        return false;
    }
}

function handleGrantRedirectUrl(url, tabId) {
    if (!url || !url.includes('options.html')) return;
    if (processedGrantRedirectUrls.has(url)) return;

    try {
        const parsed = new URL(url);
        const code = (parsed.searchParams.get('code') || '').trim();
        const state = (parsed.searchParams.get('state') || '').trim();
        if (code) {
            processedGrantRedirectUrls.add(url);
            console.log('[BACKGROUND] Intercepted Grant Access code redirect');
            exchangeGrantCodeInBackground(code, state, tabId).catch((err) => {
                processedGrantRedirectUrls.delete(url);
                console.warn('[BACKGROUND] Grant redirect exchange error:', err);
            });
            return;
        }
    } catch (e) {
        console.warn('[BACKGROUND] Failed to parse options redirect URL:', e);
    }

    const hashMatch = url.match(/#(.+)$/);
    if (hashMatch && hashMatch[1]) {
        console.log('[BACKGROUND] Intercepted options.html redirect with hash:', hashMatch[1].substring(0, 50) + '...');
        const params = new URLSearchParams(hashMatch[1]);
        const access_token = params.get('access_token');
        const resource_id = params.get('resource_id');
        if (access_token && resource_id) {
            console.log('[BACKGROUND] Storing token/resource_id from redirect hash');
            installationStorage.get([], async () => {
                const toSet = {
                    dialoguesToken: access_token,
                    dialoguesResourceId: resource_id,
                    dialoguesControlPlaneUrl: getControlPlaneUrl(),
                    _redirectHashProcessed: true
                };
                await setDialoguesErrorBadge(false);
                await setDialoguesEngineWarningBadge(false);
                installationStorage.set(toSet, () => {
                    console.log('[BACKGROUND] ✓ Token and resource_id stored from redirect');
                    closeApprovalTab(tabId);
                });
            });
        }
    }
}

// Arc blocks chrome-extension:// navigations in regular tabs; intercept before the page loads.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    handleGrantRedirectUrl(details.url, details.tabId);
});

// Intercept redirects to options.html and extract hash parameters before page loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.url && tab.url.includes('options.html')) {
        handleGrantRedirectUrl(tab.url, tabId);
    }
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
    // Only main frame (top-level page load). If you never see [NAV] logs, open a NEW tab and go to a different site (e.g. google.com). SPAs like Supabase dashboard don't trigger new navigations when you click around.
    if (details.frameId !== 0) return;
    const url = details.url;
    if (url === 'about:blank') return;
    if (isBridgePage(url)) return;

    let hostname;
    try { hostname = new URL(url).hostname; }
    catch { return; }

    if (shouldSkipHostname(hostname, skipDomains)) {
        console.log(`[NAV] Skipped domain: ${hostname}`);
        return;
    }

    // Log every top-level navigation (full page load). SPA route changes do NOT trigger this.
    console.log('[NAV] Page loaded:', url.substring(0, 60) + (url.length > 60 ? '...' : ''));

    // ─── fetch tab info ──────────────────────────────────────────────────────────
    let tab;
    try {
        tab = await chrome.tabs.get(details.tabId);
    } catch {
        console.warn('Couldn’t get tab info');
        return;
    }

    // ─── get device_name from storage ────────────────────────────────────────────
    const { device_name = '' } = await installationStorage.get({ device_name: '' });

    // ─── build your record ───────────────────────────────────────────────────────
    const record = {
        url,
        visited_at: new Date(details.timeStamp).toISOString(),
        title: tab.title,
        favicon_url: tab.favIconUrl,
        tab_id: details.tabId,
        window_id: tab.windowId,
        incognito: tab.incognito,
        transition_type: 'page_loaded',
        hostname,

        // ─── new fields ────────────────────────────────────────────────────────────
        pinned: tab.pinned,
        audible: tab.audible,
        muted: tab.mutedInfo?.muted ?? false,
        opener_tab_id: tab.openerTabId ?? null,

        // ─── device name ───────────────────────────────────────────────────────────
        device_name,
        referred_by: null
    };

    await queueVisit(record, details.documentId);
});


chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const activatedAt = new Date().toISOString();
    await actorBadge(activeInfo.tabId);
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!tab.url || tab.url === 'about:blank') return;
        if (isBridgePage(tab.url)) return;

        // Optionally, filter out skipDomains here as you do elsewhere
        let hostname;
        try { hostname = new URL(tab.url).hostname; }
        catch { return; }
        if (shouldSkipHostname(hostname, skipDomains)) {
            console.log(`Skipped domain on tab activation: ${hostname}`);
            return;
        }

        // Get device_name from storage
        const { device_name = '' } = await installationStorage.get({ device_name: '' });

        // Build your record (tab switch = revisit, so we send as browser_visits with transition_type tab_activated)
        const record = {
            url: tab.url,
            visited_at: activatedAt,
            title: tab.title,
            favicon_url: tab.favIconUrl,
            tab_id: tab.id,
            window_id: tab.windowId,
            incognito: tab.incognito,
            transition_type: 'tab_activated',
            hostname,
            pinned: tab.pinned,
            audible: tab.audible,
            muted: tab.mutedInfo?.muted ?? false,
            opener_tab_id: tab.openerTabId ?? null,
            device_name,
            referred_by: null
        };

        await queueVisit(record);
    } catch (err) {
        console.error('Error handling tab activation', err);
    }
});

async function handleStarPageMessage(msg, sender) {
    console.log('[STAR_PAGE] Received STAR_PAGE message:', msg);

    const { device_name = '' } = await installationStorage.get({ device_name: '' });

    let tabInfo = {};
    if (msg.tab_id == null && sender?.tab?.id) {
        try {
            const t = await chrome.tabs.get(sender.tab.id);
            tabInfo = {
                tab_id: t.id,
                window_id: t.windowId,
                incognito: t.incognito,
                pinned: t.pinned,
                audible: t.audible,
                muted: t.mutedInfo?.muted ?? false,
                opener_tab_id: t.openerTabId ?? null
            };
        } catch (e) {
            console.warn('[STAR_PAGE] Could not fetch tab info:', e);
        }
    }

    const record = {
        capture_id: msg.capture_id || crypto.randomUUID(),
        actor: msg._actor,
        url: msg.url,
        starred_at: msg.visited_at || new Date().toISOString(),
        visited_at: msg.visited_at || new Date().toISOString(),
        device_name,
        title: msg.title,
        favicon_url: msg.favicon_url,
        tab_id: msg.tab_id ?? tabInfo.tab_id,
        window_id: msg.window_id ?? tabInfo.window_id,
        incognito: msg.incognito ?? tabInfo.incognito,
        transition_type: msg.transition_type,
        hostname: msg.hostname,
        pinned: msg.pinned ?? tabInfo.pinned,
        audible: msg.audible ?? tabInfo.audible,
        muted: msg.muted ?? tabInfo.muted,
        opener_tab_id: msg.opener_tab_id ?? tabInfo.opener_tab_id,
        referred_by: null,
        event_type: 'star_page'
    };

    await ingestRecord({ sourceId: 'starred_websites', record, supabaseTable: 'starred_websites' });
}

async function handleClickOrHighlightMessage(msg, sender) {
    const eventType = msg.event_type || msg.type;
    let tabInfo = {};
    try {
        if (sender.tab?.id != null) {
            const t = await chrome.tabs.get(sender.tab.id);
            tabInfo = {
                tab_id: t.id,
                window_id: t.windowId,
                incognito: t.incognito,
                pinned: t.pinned,
                audible: t.audible,
                muted: t.mutedInfo?.muted ?? false,
                opener_tab_id: t.openerTabId ?? null
            };
        }
    } catch (e) {
        console.warn('Could not fetch tab info for event:', e);
    }

    const record = {
        capture_id: msg.capture_id || crypto.randomUUID(),
        actor: msg._actor,
        url: msg.url,
        visited_at: msg.visited_at,
        title: msg.title,
        favicon_url: msg.favicon_url,
        hostname: msg.hostname,
        transition_type: msg.transition_type,
        device_name: msg.device_name,
        user_id: msg.user_id,
        referred_by: msg.referred_by,
        event_type: eventType,
        content: msg.content,
        ...tabInfo
    };

    await ingestRecord({ sourceId: 'browser_events', record });
}

async function handleVideoPlayMessage(msg, sender) {
    let host;
    try {
        host = new URL(msg.url).hostname;
    } catch {
        console.warn('Invalid page URL for VIDEO_PLAY:', msg.url);
        host = null;
    }
    if (host && shouldSkipHostname(host, skipDomains)) {
        console.log('Skipped video_play on domain:', host);
        return;
    }

    let tabInfo = {};
    try {
        if (sender.tab?.id != null) {
            const t = await chrome.tabs.get(sender.tab.id);
            tabInfo = {
                tab_id: t.id,
                window_id: t.windowId,
                incognito: t.incognito,
                pinned: t.pinned,
                audible: t.audible,
                muted: t.mutedInfo?.muted ?? false,
                opener_tab_id: t.openerTabId ?? null
            };
        }
    } catch (e) {
        console.warn('Could not fetch tab info for VIDEO_PLAY', e);
    }

    const record = {
        capture_id: msg.capture_id || crypto.randomUUID(),
        actor: msg._actor,
        url: msg.url,
        visited_at: msg.visited_at,
        title: msg.title,
        favicon_url: msg.favicon_url,
        hostname: host,
        transition_type: 'video_play',
        device_name: msg.device_name,
        user_id: msg.user_id,
        referred_by: msg.referred_by,
        event_type: 'VIDEO_PLAY',
        content: msg.content,
        ...tabInfo
    };

    await ingestRecord({ sourceId: 'browser_events', record });
}

async function handleContentScriptMessage(msg, sender) {
    console.log('[CONTENT_EVENT] Received:', msg.event_type || msg.type, msg.url?.slice?.(0, 80));

    const eventType = msg.event_type || msg.type;
    if (eventType === 'STAR_PAGE' || msg.type === 'STAR_PAGE') {
        await handleStarPageMessage(msg, sender);
        return;
    }
    if (eventType === 'click' || eventType === 'highlight') {
        await handleClickOrHighlightMessage(msg, sender);
        return;
    }
    if (eventType === 'VIDEO_PLAY') {
        await handleVideoPlayMessage(msg, sender);
    }
}

async function captureContentMessage(msg, sender) {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return;
    const occurred = Date.parse(msg.visited_at);
    const at = Number.isFinite(occurred) && Math.abs(Date.now() - occurred) < 60000 ? occurred : Date.now();
    const actor = await captureActor(sender.tab.id, msg.automation_signals || {}, at, sender.documentId);
    await pendingActivity.resolve(sender.tab.id, actor, sender.documentId);
    await actorBadge(sender.tab.id, actor);
    // An old content script may still carry a synchronized device name after
    // an upgrade. The browser's local name is authoritative at capture time.
    const { device_name = '' } = await installationStorage.get({ device_name: '' });
    const safe = { ...msg, device_name, capture_id: crypto.randomUUID(), _actor: actor, tab_id: undefined };
    await handleContentScriptMessage(safe, sender);
}

// MV3: return true so the worker stays alive until async ingest completes; must call sendResponse.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'AGENT_BRIDGE_READY') {
        if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !isBridgePage(sender.url)) return false;
        connectAgentTab(sender.tab.id, sender.url).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    const task = (msg.type?.startsWith('ACTOR_') || msg.type === 'AUTOMATION_HINT')
        ? handleActorMessage(msg, sender)
        : captureContentMessage(msg, sender);
    task
        .then(result => sendResponse(result || { ok: true }))
        .catch((err) => {
            console.error('[CONTENT_EVENT] Handler failed:', err);
            sendResponse({ ok: false, error: err.message });
        });
    return true;
});

// Context menu: Star Site
chrome.runtime.onInstalled.addListener(() => {
    try {
        chrome.contextMenus.create({
            id: 'star-site',
            title: 'Star Site',
            contexts: ['page', 'action']
        });
    } catch (e) {
        console.warn('Context menu creation failed (maybe already exists):', e);
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'star-site') return;
    if (!tab || !tab.id || !tab.url) return;

    // Fill in message payload similar to content -> background flow
    const url = tab.url;
    let hostname;
    try { hostname = new URL(url).hostname; } catch { hostname = null; }

    const payload = {
        type: 'STAR_PAGE',
        event_type: 'STAR_PAGE',
        url,
        title: tab.title,
        favicon_url: tab.favIconUrl,
        tab_id: tab.id,
        window_id: tab.windowId,
        incognito: tab.incognito,
        transition_type: 'context_menu',
        hostname,
        pinned: tab.pinned,
        audible: tab.audible,
        muted: tab.mutedInfo?.muted ?? false,
        opener_tab_id: tab.openerTabId ?? null
    };

    payload._actor = await captureActor(tab.id);
    payload.capture_id = crypto.randomUUID();
    await handleStarPageMessage(payload, { tab });
});

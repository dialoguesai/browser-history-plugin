console.log('[BACKGROUND] Service worker started');
import { getControlPlaneUrl } from './lib/config.js';
import { buildSkipList, shouldSkipHostname } from './lib/skipDomains.js';
import { dispatchRecord } from './lib/dispatch.js';
import { exchangeGrantCode } from './lib/grantAccess.js';
import { resetSupabaseClient } from './lib/supabaseIngest.js';
import { registerInstallRedirects } from './lib/registerRedirect.js';

let skipDomains = buildSkipList([]);

function initFromStorage() {
    chrome.storage.sync.get(
        {
            supabaseUrl: '',
            anonKey: '',
            skipDomains: [],
            redirectSetupDone: false
        },
        ({ skipDomains: userDomains, redirectSetupDone }) => {
            resetSupabaseClient();
            skipDomains = buildSkipList(userDomains);
            console.log('Effective skip list:', skipDomains);
            const cp = getControlPlaneUrl();
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
            await chrome.storage.sync.set({ dialoguesConnectionExpired: true });
        } else {
            await chrome.storage.sync.remove(['dialoguesConnectionExpired']);
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
            await chrome.storage.sync.set({ dialoguesEngineWarning: true });
        } else {
            await chrome.storage.sync.remove(['dialoguesEngineWarning']);
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
        const { dialoguesConnectionExpired, dialoguesEngineWarning } = await chrome.storage.sync.get({
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
chrome.storage.onChanged.addListener(initFromStorage);
// When connection-expired or engine-warning is cleared, refresh badge.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    const expiredCleared = 'dialoguesConnectionExpired' in changes && changes.dialoguesConnectionExpired.newValue === undefined;
    const engineWarningCleared = 'dialoguesEngineWarning' in changes && changes.dialoguesEngineWarning.newValue === undefined;
    if (expiredCleared || engineWarningCleared) {
        refreshDialoguesBadge().catch(() => {});
    }
});

async function applyToposIngestResult(result, sourceId, recordCount = 1) {
    if (!result || result.reason === 'not_attached') return;
    if (result.reason === 'auth_expired') {
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
        console.log('[APP_INGEST] Successfully sent', sourceId, `(${recordCount} record(s))`);
        await setDialoguesEngineWarningBadge(false);
        return;
    }
    console.warn('[APP_INGEST] Topos ingest issue:', sourceId, result);
    await setDialoguesEngineWarningBadge(true);
}

async function ingestRecord({ sourceId, record, supabaseTable = 'browserplugin' }) {
    const results = await dispatchRecord({ sourceId, record, supabaseTable });
    await applyToposIngestResult(results.topos, sourceId);
    if (results.supabase?.sent) {
        console.log('[SUPABASE] Logged', sourceId, record.url?.slice?.(0, 60));
    } else if (results.supabase?.reason === 'insert_error') {
        console.error('[SUPABASE] insert error:', results.supabase.error);
    }
    return results;
}

const processedGrantRedirectUrls = new Set();

function closeApprovalTab(tabId) {
    if (tabId == null) return;
    chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
            console.log('[BACKGROUND] Approval tab already closed:', chrome.runtime.lastError.message);
        }
        chrome.storage.sync.remove(['_approvalTabId']);
    });
}

async function exchangeGrantCodeInBackground(code, state, tabId) {
    const base = await chrome.storage.sync.get({
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
        await chrome.storage.sync.set({
            dialoguesToken: runToken,
            dialoguesResourceId: resourceId,
            dialoguesControlPlaneUrl: controlPlaneUrl,
            _grantQueryProcessed: true
        });
        await chrome.storage.sync.remove(['_grantPendingState', '_grantPkceVerifier']);
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
            chrome.storage.sync.get([], async () => {
                const toSet = {
                    dialoguesToken: access_token,
                    dialoguesResourceId: resource_id,
                    dialoguesControlPlaneUrl: getControlPlaneUrl(),
                    _redirectHashProcessed: true
                };
                await setDialoguesErrorBadge(false);
                await setDialoguesEngineWarningBadge(false);
                chrome.storage.sync.set(toSet, () => {
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
    const { device_name = '' } = await chrome.storage.sync.get({ device_name: '' });

    // ─── build your record ───────────────────────────────────────────────────────
    const record = {
        url,
        visited_at: new Date().toISOString(),
        title: tab.title,
        favicon_url: tab.favIconUrl,
        tab_id: details.tabId,
        window_id: details.windowId,
        incognito: tab.incognito,
        transition_type: details.transitionType,
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

    const results = await ingestRecord({ sourceId: 'browser_visits', record });
    if (!results.topos?.sent && !results.supabase?.sent) {
        console.log(
            '[APP_INGEST] No sink configured — attach Dialogues (Topos tab) and/or set Supabase in Options.'
        );
    }
});


chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!tab.url || tab.url === 'about:blank') return;

        // Optionally, filter out skipDomains here as you do elsewhere
        let hostname;
        try { hostname = new URL(tab.url).hostname; }
        catch { return; }
        if (shouldSkipHostname(hostname, skipDomains)) {
            console.log(`Skipped domain on tab activation: ${hostname}`);
            return;
        }

        // Get device_name from storage
        const { device_name = '' } = await chrome.storage.sync.get({ device_name: '' });

        // Build your record (tab switch = revisit, so we send as browser_visits with transition_type tab_activated)
        const record = {
            url: tab.url,
            visited_at: new Date().toISOString(),
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

        await ingestRecord({ sourceId: 'browser_visits', record });
    } catch (err) {
        console.error('Error handling tab activation', err);
    }
});

async function handleStarPageMessage(msg, sender) {
    console.log('[STAR_PAGE] Received STAR_PAGE message:', msg);

    const { device_name = '' } = await chrome.storage.sync.get({ device_name: '' });

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
        url: msg.url,
        starred_at: new Date().toISOString(),
        visited_at: new Date().toISOString(),
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
        if (sender.tab?.id) {
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
        if (sender.tab?.id) {
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

// MV3: return true so the worker stays alive until async ingest completes; must call sendResponse.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleContentScriptMessage(msg, sender)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
            console.error('[CONTENT_EVENT] Handler failed:', err);
            sendResponse({ ok: false });
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

    await handleStarPageMessage(payload, { tab });
});
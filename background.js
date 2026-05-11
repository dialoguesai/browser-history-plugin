console.log('[BACKGROUND] Service worker started');
// background.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// 1) your built‑in skip list
const defaultSkipDomains = [
    'airtable.com',
    'stripe.network',
    'js.stripe.com',
    'accounts.youtube.com',
    'accounts.google.com',
    'newassets.hcaptcha.com'
];
// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let supabase = null;
// this will end up containing defaultSkipDomains + whatever the user adds
let skipDomains = [...defaultSkipDomains];

/**
 * Normalize a skip-list line to a hostname. Accepts bare hostnames, full URLs (any path),
 * or host/path without a scheme so all routes on that host match.
 */
function normalizeSkipDomainEntry(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    try {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
            return new URL(s).hostname.toLowerCase();
        }
        let hostPart = s.split('/')[0];
        if (!hostPart) return null;
        if (hostPart.startsWith('[')) {
            const end = hostPart.indexOf(']');
            return end === -1 ? null : hostPart.slice(1, end).toLowerCase();
        }
        if (hostPart.includes(':')) {
            hostPart = hostPart.split(':')[0];
        }
        return hostPart || null;
    } catch {
        return null;
    }
}

/** True if this page host is skipped (exact host or subdomain of a skip entry). */
function shouldSkipHostname(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    return skipDomains.some((entry) => {
        const pattern = normalizeSkipDomainEntry(entry);
        if (!pattern) return false;
        return host === pattern || host.endsWith('.' + pattern);
    });
}

function initFromStorage() {
    chrome.storage.sync.get({
        supabaseUrl: '',
        anonKey: '',
        skipDomains: []     // user‑added domains
    }, ({ supabaseUrl, anonKey, skipDomains: userDomains }) => {
        // re‑init Supabase client if creds are set
        if (supabaseUrl && anonKey) {
            supabase = createClient(supabaseUrl, anonKey);
        } else {
            supabase = null;
        }

        // merge default + user domains (dedupe by normalized hostname vs defaults)
        const defaultNorm = new Set(
            defaultSkipDomains.map(normalizeSkipDomainEntry).filter(Boolean)
        );
        skipDomains = [
            ...defaultSkipDomains,
            ...userDomains.filter((d) => {
                const h = normalizeSkipDomainEntry(d);
                return h && !defaultNorm.has(h);
            })
        ];
        console.log('Effective skip list:', skipDomains);
    });
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

/** When Attach Dialogues is active, send records to Control Plane app_ingest. Handles 401/403 (clears token). */
async function sendToControlPlaneAppIngest(sourceId, records) {
    const { dialoguesToken, dialoguesResourceId, dialoguesControlPlaneUrl } = await chrome.storage.sync.get({
        dialoguesToken: '',
        dialoguesResourceId: '',
        dialoguesControlPlaneUrl: ''
    });
    if (!dialoguesToken || !dialoguesResourceId || !dialoguesControlPlaneUrl) return;
    const controlPlaneUrl = dialoguesControlPlaneUrl.replace(/\/$/, '');
    const appIngestUrl = `${controlPlaneUrl}/v1/ingestion/app_ingest`;
    try {
        const response = await fetch(appIngestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${dialoguesToken}`
            },
            body: JSON.stringify({
                resource_id: dialoguesResourceId,
                source_id: sourceId,
                records
            })
        });
        if (response.status === 401 || response.status === 403) {
            const errorBody = await response.text();
            console.warn('[APP_INGEST] Token rejected:', response.status, '— Server says:', errorBody || '(no body)');
            await setDialoguesErrorBadge(true);
            await chrome.storage.sync.remove(['dialoguesToken', 'dialoguesResourceId']);
            chrome.notifications?.create({
                type: 'basic',
                iconUrl: 'icons/icon-48.png',
                title: 'Dialogues Connection Expired',
                message: 'Please re-attach Dialogues in the extension options.'
            });
        } else if (response.status === 502 || response.status === 503) {
            console.warn('[APP_INGEST] Engine unavailable:', response.status, await response.text());
            await setDialoguesEngineWarningBadge(true);
        } else if (!response.ok) {
            console.error('[APP_INGEST] Failed to send', sourceId, ':', response.status, await response.text());
            await setDialoguesEngineWarningBadge(true);
        } else {
            console.log('[APP_INGEST] Successfully sent', sourceId, 'to Control Plane');
            await setDialoguesEngineWarningBadge(false);
        }
    } catch (err) {
        console.error('[APP_INGEST] Error sending', sourceId, 'to Control Plane:', err);
        await setDialoguesEngineWarningBadge(true);
    }
}

// Intercept redirects to options.html and extract hash parameters before page loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.url && tab.url.includes('options.html')) {
        // New Grant Access flow: options.html?code=...&state=...
        try {
            const parsed = new URL(tab.url);
            const code = (parsed.searchParams.get('code') || '').trim();
            const state = (parsed.searchParams.get('state') || '').trim();
            if (code) {
                console.log('[BACKGROUND] Intercepted Grant Access code redirect');
                chrome.storage.sync.get(
                    ['dialoguesUrl', 'dialoguesControlPlaneUrl', 'dialoguesClientSecret', '_grantPendingState'],
                    async (base) => {
                        try {
                            const controlPlaneUrl = (base.dialoguesControlPlaneUrl || base.dialoguesUrl || '').replace(/\/$/, '');
                            const dialoguesClientSecret = (base.dialoguesClientSecret || '').trim();
                            if (!controlPlaneUrl) {
                                console.warn('[BACKGROUND] Missing Control Plane URL; cannot exchange grant code');
                                return;
                            }
                            if (state && base._grantPendingState && state !== base._grantPendingState) {
                                console.warn('[BACKGROUND] Grant state mismatch; attempting exchange anyway');
                            }
                            const exchangeResp = await fetch(`${controlPlaneUrl}/connect/exchange`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Accept': 'application/json'
                                },
                                body: JSON.stringify({
                                    code,
                                    app_id: 'browser-plugin',
                                    ...(dialoguesClientSecret ? { client_secret: dialoguesClientSecret } : {})
                                })
                            });
                            const payload = await exchangeResp.json().catch(() => ({}));
                            if (!exchangeResp.ok) {
                                console.warn(
                                    '[BACKGROUND] Grant exchange failed:',
                                    exchangeResp.status,
                                    payload?.error_description || payload?.error || '(no error body)'
                                );
                                return;
                            }
                            const runToken = String(payload?.plugin_attach_token || payload?.mcp_access_token || '').trim();
                            const resourceId = String(payload?.resource_id || '').trim();
                            if (!runToken || !resourceId) {
                                console.warn('[BACKGROUND] Grant exchange missing token/resource_id');
                                return;
                            }
                            await setDialoguesErrorBadge(false);
                            await setDialoguesEngineWarningBadge(false);
                            chrome.storage.sync.set({
                                dialoguesToken: runToken,
                                dialoguesResourceId: resourceId,
                                dialoguesControlPlaneUrl: controlPlaneUrl,
                                _grantQueryProcessed: true
                            }, () => {
                                console.log('[BACKGROUND] ✓ Token/resource_id stored from Grant Access code exchange');
                                chrome.storage.sync.remove(['_grantPendingState']);
                                // Navigate to clean options URL to avoid client blockers on query callback URLs.
                                chrome.tabs.update(tabId, { url: chrome.runtime.getURL('options.html') });
                            });
                        } catch (err) {
                            console.warn('[BACKGROUND] Grant redirect exchange error:', err);
                        }
                    }
                );
                return;
            }
        } catch (e) {
            console.warn('[BACKGROUND] Failed to parse options redirect URL:', e);
        }

        const hashMatch = tab.url.match(/#(.+)$/);
        if (hashMatch && hashMatch[1]) {
            console.log('[BACKGROUND] Intercepted options.html redirect with hash:', hashMatch[1].substring(0, 50) + '...');
            const params = new URLSearchParams(hashMatch[1]);
            const access_token = params.get('access_token');
            const resource_id = params.get('resource_id');
            if (access_token && resource_id) {
                console.log('[BACKGROUND] Storing token/resource_id from redirect hash');
                // Preserve dialoguesControlPlaneUrl (set when user clicked Attach Dialogues)
                chrome.storage.sync.get(['dialoguesUrl', 'dialoguesControlPlaneUrl'], async (base) => {
                    const controlPlaneUrl = (base.dialoguesControlPlaneUrl || base.dialoguesUrl || '').replace(/\/$/, '');
                    const toSet = {
                        dialoguesToken: access_token,
                        dialoguesResourceId: resource_id,
                        _redirectHashProcessed: true
                    };
                    if (controlPlaneUrl) toSet.dialoguesControlPlaneUrl = controlPlaneUrl;
                    await setDialoguesErrorBadge(false);
                    await setDialoguesEngineWarningBadge(false);
                    chrome.storage.sync.set(toSet, () => {
                        console.log('[BACKGROUND] ✓ Token and resource_id stored from redirect; control plane URL:', controlPlaneUrl || '(not set – set Dialogues URL in Options and re-attach)');
                    });
                });
            }
        }
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

    if (shouldSkipHostname(hostname)) {
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

    // ─── Sprint 3: Check if "Attach Dialogues" is active ────────────────────────
    const { dialoguesToken, dialoguesResourceId, dialoguesControlPlaneUrl } = await chrome.storage.sync.get({
        dialoguesToken: '',
        dialoguesResourceId: '',
        dialoguesControlPlaneUrl: ''
    });

    if (dialoguesToken && dialoguesResourceId && dialoguesControlPlaneUrl) {
        // "Attach Dialogues" is active - send to Control Plane app_ingest
        const controlPlaneUrl = dialoguesControlPlaneUrl.replace(/\/$/, '');
        const appIngestUrl = `${controlPlaneUrl}/v1/ingestion/app_ingest`;
        console.log('[APP_INGEST] Sending to Control Plane:', appIngestUrl);
        try {
            const response = await fetch(appIngestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${dialoguesToken}`
                },
                body: JSON.stringify({
                    resource_id: dialoguesResourceId,
                    source_id: 'browser_visits',
                    records: [record]
                })
            });

            if (response.status === 401 || response.status === 403) {
                const errorBody = await response.text();
                console.warn('[APP_INGEST] Token rejected:', response.status, '— Server says:', errorBody || '(no body)');
                await setDialoguesErrorBadge(true);
                await chrome.storage.sync.remove(['dialoguesToken', 'dialoguesResourceId']);
                chrome.notifications?.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: 'Dialogues Connection Expired',
                    message: 'Please re-attach Dialogues in the extension options.'
                });
            } else if (response.status === 502 || response.status === 503 || !response.ok) {
                const errorText = await response.text();
                console.warn('[APP_INGEST] Engine unavailable:', response.status, errorText || '(no body)');
                await setDialoguesEngineWarningBadge(true);
            } else {
                console.log('[APP_INGEST] Successfully sent visit to Control Plane');
                await setDialoguesEngineWarningBadge(false);
            }
        } catch (err) {
            console.error('[APP_INGEST] Error sending visit to Control Plane:', err);
            await setDialoguesEngineWarningBadge(true);
        }
    } else {
        // So you can see why no request is sent (check Service Worker console)
        if (!dialoguesToken) console.log('[APP_INGEST] Not sending: no dialoguesToken (Attach Dialogues not done or cleared)');
        else if (!dialoguesResourceId) console.log('[APP_INGEST] Not sending: no dialoguesResourceId');
        else if (!dialoguesControlPlaneUrl) console.log('[APP_INGEST] Not sending: no dialoguesControlPlaneUrl');
    }

    // ─── Also insert into Supabase if configured (for backward compatibility) ───
    if (supabase) {
        try {
            const { error } = await supabase
                .from('browserplugin')
                .insert(record);

            if (error) console.error('Supabase insert error:', error);
            else console.log('Logged visit to Supabase:', record);
        } catch (err) {
            console.error('Unexpected error logging visit to Supabase', err);
        }
    } else if (!dialoguesToken) {
        console.warn(
            '[APP_INGEST] Neither Supabase nor Dialogues configured; skipping insert. ' +
            'To use Dialogues: open extension Options → set "Dialogues URL" (e.g. https://cp.logu3s.com) → click "Attach Dialogues" and complete the consent flow.'
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
        if (shouldSkipHostname(hostname)) {
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

        // When Attach Dialogues is active, send tab switch as a visit (so "going back to a tab" counts)
        await sendToControlPlaneAppIngest('browser_visits', [record]);

        // Insert into Supabase if configured
        if (supabase) {
            const { error } = await supabase.from('browserplugin').insert(record);
            if (error) console.error('Supabase insert error (tab activated):', error);
            else console.log('Logged tab activation:', record);
        }
    } catch (err) {
        console.error('Error handling tab activation', err);
    }
});

chrome.runtime.onMessage.addListener(async (msg, sender) => {
    console.log('🛰️ BG onMessage:', msg, sender);
    // Handle starring a page
    // console.log('Saving to supabase...')
    if (msg.type === 'STAR_PAGE') {
        console.log('[STAR_PAGE] Received STAR_PAGE message:', msg);

        // ─── get device_name from storage ────────────────────────────────────────────
        const { device_name = '' } = await chrome.storage.sync.get({ device_name: '' });
        console.log('[STAR_PAGE] device_name from storage:', device_name);

        // Build record for starred_websites table and/or Control Plane browser_events
        const record = {
            url: msg.url,
            starred_at: new Date().toISOString(),
            visited_at: new Date().toISOString(),
            device_name,
            title: msg.title,
            favicon_url: msg.favicon_url,
            tab_id: msg.tab_id,
            window_id: msg.window_id,
            incognito: msg.incognito,
            transition_type: msg.transition_type,
            hostname: msg.hostname,
            pinned: msg.pinned,
            audible: msg.audible,
            muted: msg.muted,
            opener_tab_id: msg.opener_tab_id,
            referred_by: null,
            event_type: 'star_page'
        };
        console.log('[STAR_PAGE] Record to insert:', record);

        // When Attach Dialogues is active, send to Control Plane app_ingest (browser_events)
        await sendToControlPlaneAppIngest('browser_events', [record]);

        if (supabase) {
            try {
                const result = await supabase.from('starred_websites').insert(record);
                console.log('[STAR_PAGE] Supabase insert result:', result);
                if (result.error) {
                    console.error('[STAR_PAGE] Supabase star insert error:', result.error);
                    chrome.notifications?.create({
                        type: 'basic',
                        iconUrl: 'icons/icon-48.png',
                        title: 'Star Website',
                        message: 'Failed to star website: ' + (result.error.message || 'Unknown error')
                    });
                } else {
                    console.log('[STAR_PAGE] Starred website successfully:', record);
                    chrome.notifications?.create({
                        type: 'basic',
                        iconUrl: 'icons/icon-48.png',
                        title: 'Star Website',
                        message: 'Website starred successfully!'
                    });
                }
            } catch (err) {
                console.error('[STAR_PAGE] Unexpected error starring website', err);
                chrome.notifications?.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: 'Star Website',
                    message: 'Unexpected error: ' + (err.message || 'Unknown error')
                });
            }
        } else {
            const { dialoguesToken } = await chrome.storage.sync.get({ dialoguesToken: '' });
            if (!dialoguesToken) {
                chrome.notifications?.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: 'Star Website',
                    message: 'Supabase not configured. Use Attach Dialogues in Options to save stars.'
                });
            }
        }
        return;
    }

    // Enhanced event tracking for "click" and "highlight" events
    if (msg.event_type === 'click' || msg.event_type === 'highlight') {
        // Try to fill in tab details if we can
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

        // Build the full record to satisfy every non-null column
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
            event_type: msg.event_type,
            content: msg.content,
            ...tabInfo
        };

        // When Attach Dialogues is active, send to Control Plane app_ingest (browser_events)
        await sendToControlPlaneAppIngest('browser_events', [record]);

        // Legacy Supabase path: only if Supabase is configured (and Attach Dialogues may not be active)
        if (supabase) {
            try {
                const { error } = await supabase
                    .from('browserplugin')
                    .insert(record);

                if (error) {
                    console.error(`[${msg.event_type}] Supabase insert error:`, error);
                } else {
                    console.log(`[${msg.event_type}] Event logged:`, record);
                }
            } catch (err) {
                console.error(`[${msg.event_type}] Unexpected error logging event`, err);
            }
        }

        return;
    }
    if (msg.event_type === 'VIDEO_PLAY') {
        if (!supabase) return;

        // 1) Use the page URL for filtering (blob: URLs will break URL())
        let host;
        try {
            host = new URL(msg.url).hostname;
        } catch {
            console.warn('Invalid page URL for VIDEO_PLAY:', msg.url);
            host = null;
        }
        if (host && shouldSkipHostname(host)) {
            console.log('Skipped video_play on domain:', host);
            return;
        }

        // 2) Optionally enrich with tab info
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

        // 3) Build the complete record matching your schema
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
            event_type: msg.event_type,
            content: msg.content,   // { videoUrl: 'blob:…' }
            ...tabInfo
        };

        // When Attach Dialogues is active, send to Control Plane app_ingest (browser_events)
        await sendToControlPlaneAppIngest('browser_events', [record]);

        if (supabase) {
            const { error } = await supabase.from('browserplugin').insert(record);
            if (error) console.error('[VIDEO_PLAY] Supabase insert error:', error);
            else console.log('[VIDEO_PLAY] Event logged:', record);
        }

        return; // done handling VIDEO_PLAY
    }
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

    // Reuse existing STAR_PAGE handler
    chrome.runtime.sendMessage(payload);
});
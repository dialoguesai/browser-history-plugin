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

        // merge default + user domains
        skipDomains = [
            ...defaultSkipDomains,
            ...userDomains.filter(d => d && !defaultSkipDomains.includes(d))
        ];
        console.log('Effective skip list:', skipDomains);
    });
}

// run once on load
initFromStorage();
// re‑run whenever options change
chrome.storage.onChanged.addListener(initFromStorage);

chrome.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const url = details.url;
    if (url === 'about:blank') return;

    let hostname;
    try { hostname = new URL(url).hostname; }
    catch { return; }

    if (skipDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
        console.log(`Skipped domain: ${hostname}`);
        return;
    }

    if (!supabase) {
        console.warn('Supabase not configured; skipping insert.');
        return;
    }

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

    // ─── insert into Supabase ──────────────────────────────────────────────────
    try {
        const { error } = await supabase
            .from('browserplugin')
            .insert(record);

        if (error) console.error('Supabase insert error:', error);
        else console.log('Logged visit:', record);
    } catch (err) {
        console.error('Unexpected error logging visit', err);
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
        if (skipDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
            console.log(`Skipped domain on tab activation: ${hostname}`);
            return;
        }

        // Get device_name from storage
        const { device_name = '' } = await chrome.storage.sync.get({ device_name: '' });

        // Build your record
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

        // Insert into Supabase
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

        if (!supabase) {
            console.warn('[STAR_PAGE] Supabase not configured; skipping star log.');
            chrome.notifications?.create({
                type: 'basic',
                iconUrl: 'icons/icon-48.png',
                title: 'Star Website',
                message: 'Supabase not configured. Check your settings.'
            });
            return;
        }

        // Log Supabase client state
        try {
            console.log('[STAR_PAGE] Supabase client:', supabase);
        } catch (e) {
            console.warn('[STAR_PAGE] Could not log Supabase client:', e);
        }

        // ─── get device_name from storage ────────────────────────────────────────────
        const { device_name = '' } = await chrome.storage.sync.get({ device_name: '' });
        console.log('[STAR_PAGE] device_name from storage:', device_name);

        // Build record for starred_websites table
        const record = {
            url: msg.url,
            starred_at: new Date().toISOString(),
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
            referred_by: null
        };
        console.log('[STAR_PAGE] Record to insert:', record);

        try {
            const result = await supabase
                .from('starred_websites')
                .insert(record);

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
        return;
    }

    // Enhanced event tracking for "click" and "highlight" events
    if (msg.event_type === 'click' || msg.event_type === 'highlight') {
        if (!supabase) {
            console.warn(`[${msg.event_type}] Supabase not configured; skipping event log.`);
            return;
        }

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
        if (host && skipDomains.some(d => host === d || host.endsWith(`.${d}`))) {
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

        // 4) Insert into Supabase
        const { error } = await supabase.from('browserplugin').insert(record);
        if (error) {
            console.error('[VIDEO_PLAY] Supabase insert error:', error);
        } else {
            console.log('[VIDEO_PLAY] Event logged:', record);
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
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

chrome.runtime.onMessage.addListener(async (msg, sender) => {
    // Handle starring a page
    console.log('Saving to supabase...')
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
            opener_tab_id: msg.opener_tab_id
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

    if (msg.type !== 'VIDEO_PLAY') return;
    if (!supabase) {
        console.warn('Supabase not configured; skipping video log.');
        return;
    }

    // Optional: filter out hosts you don’t care about
    const host = new URL(msg.videoUrl).hostname;
    if (skipDomains.some(d => host === d || host.endsWith(`.${d}`))) {
        console.log('Skipped video from', host);
        return;
    }

    // ─── get device_name from storage ────────────────────────────────────────────
    const { device_name = '' } = await chrome.storage.sync.get({ device_name: '' });

    // Insert into Supabase alongside your page‐view data
    const { error } = await supabase
        .from('browserplugin')
        .insert({
            url: msg.videoUrl,
            visited_at: msg.timestamp,
            title: msg.pageTitle,
            hostname: host,
            transition_type: 'video_play',
            referrer: msg.pageUrl,
            // …any other fields you like…
            device_name,
        });

    if (error) console.error('Error logging video play:', error);
    else console.log('Logged video play:', msg.videoUrl);
});
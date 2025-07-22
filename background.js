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
        });

    if (error) console.error('Error logging video play:', error);
    else console.log('Logged video play:', msg.videoUrl);
});
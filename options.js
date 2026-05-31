// options.js
console.log('[OPTIONS] ⚡ Script file loaded!');

// Update visual status indicator
try {
    const statusEl = document.getElementById('scriptStatusText');
    if (statusEl) statusEl.textContent = 'Script loaded ✓';
} catch (e) {
    console.warn('[OPTIONS] Could not update status (DOM not ready):', e);
}

// grabs elements (will be null until DOM loads, that's OK)
const urlInput = document.getElementById('supabaseUrl');
const keyInput = document.getElementById('anonKey');
const listInput = document.getElementById('skipList');
const deviceNameInput = document.getElementById('deviceName');
const showStarButtonInput = document.getElementById('showStarButton');
const saveButton = document.getElementById('save');
const statusText = document.getElementById('status');
const dialoguesUrlInput = document.getElementById('dialoguesUrl');
const dialoguesClientSecretInput = document.getElementById('dialoguesClientSecret');
const attachDialoguesBtn = document.getElementById('attachDialogues');
const detachDialoguesBtn = document.getElementById('detachDialogues');
const attachStatusSpan = document.getElementById('attachStatus');

// Control Plane base URL (hosts connect-app: Keycloak auth + consent + UMA exchange).
// Connect-app grants MVP scopes activity:read + activity:write (→ Keycloak read/write) so the RPT can POST /v1/ingestion/app_ingest.
const DEFAULT_DIALOGUES_URL = 'https://cp.logu3s.com';
const DIALOGUES_CONNECT_APP_ID = 'browser-plugin';
const DIALOGUES_GRANT_SOURCE_ID = 'browser_visits';
const DIALOGUES_GRANT_SCOPES = 'activity:read,activity:write';
let grantQueryHandled = false;

function updateAttachUI(items) {
    const hasToken = !!(items.dialoguesToken && items.dialoguesResourceId);
    detachDialoguesBtn.style.display = hasToken ? 'inline-block' : 'none';
    attachStatusSpan.textContent = hasToken ? 'Attached' : '';
    attachStatusSpan.style.color = hasToken ? 'green' : '';
    // Update debug info
    const debugEl = document.getElementById('debugInfo');
    if (debugEl) {
        debugEl.textContent = hasToken
            ? `✓ Token: ${items.dialoguesToken.substring(0, 30)}...\n✓ Resource: ${items.dialoguesResourceId}`
            : 'No token/resource_id stored';
    }
}

function setAttachStatus(message, color = '') {
    if (!attachStatusSpan) return;
    attachStatusSpan.textContent = message || '';
    attachStatusSpan.style.color = color || '';
}

// On load: parse hash from redirect (connect-app returns here with #access_token=...&resource_id=...)
function parseRedirectHash() {
    const fullUrl = window.location.href;
    const hashWithHash = window.location.hash;
    const hash = hashWithHash.slice(1);
    console.log('[OPTIONS] parseRedirectHash() called');
    console.log('[OPTIONS] Full URL:', fullUrl);
    console.log('[OPTIONS] Hash (with #):', hashWithHash);
    console.log('[OPTIONS] Hash (without #):', hash);
    console.log('[OPTIONS] Hash length:', hash.length);
    
    // First, check if background.js already stored the token from the redirect
    chrome.storage.sync.get(['dialoguesToken', 'dialoguesResourceId', '_redirectHashProcessed'], (result) => {
        if (result._redirectHashProcessed && result.dialoguesToken && result.dialoguesResourceId) {
            console.log('[OPTIONS] ✓ Found token/resource_id in storage (from background.js redirect intercept)');
            console.log('[OPTIONS] ✓✓✓ Token and resource_id saved successfully!');
            // Clear the flag
            chrome.storage.sync.remove('_redirectHashProcessed');
            updateAttachUI({ dialoguesToken: result.dialoguesToken, dialoguesResourceId: result.dialoguesResourceId });
            const statusEl = document.getElementById('attachStatus');
            if (statusEl) {
                statusEl.textContent = '✓ Attached successfully!';
                statusEl.style.color = 'green';
            }
            const originalTitle = document.title;
            document.title = '✓ Attached - ' + originalTitle;
            setTimeout(() => { document.title = originalTitle; }, 2000);
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            // Close the approval tab
            _closeApprovalTabIfNeeded();
            return;
        }
        chrome.storage.sync.get(['dialoguesToken', 'dialoguesResourceId', '_grantQueryProcessed'], (grantResult) => {
            if (grantResult._grantQueryProcessed && grantResult.dialoguesToken && grantResult.dialoguesResourceId) {
                console.log('[OPTIONS] ✓ Found token/resource_id in storage (from Grant Access code exchange)');
                chrome.storage.sync.remove('_grantQueryProcessed');
                updateAttachUI({ dialoguesToken: grantResult.dialoguesToken, dialoguesResourceId: grantResult.dialoguesResourceId });
                const statusEl = document.getElementById('attachStatus');
                if (statusEl) {
                    statusEl.textContent = '✓ Attached successfully!';
                    statusEl.style.color = 'green';
                }
                _closeApprovalTabIfNeeded();
                return;
            }
        });
        
        // Try to extract hash from URL (check both window.location.hash and URL string)
        let hashToParse = hash;
        if (!hashToParse || hashToParse.length === 0) {
            // Double-check: sometimes hash is in the URL string but not window.location.hash
            const hashMatch = fullUrl.match(/#(.+)$/);
            if (hashMatch && hashMatch[1]) {
                console.log('[OPTIONS] Found hash in URL string (not in window.location.hash)');
                hashToParse = hashMatch[1];
            } else {
                console.log('[OPTIONS] No hash found in URL - redirect may not have completed or hash was cleared');
                return;
            }
        }
        
        // Parse hash
        console.log('[OPTIONS] ✓ REDIRECT DETECTED! Parsing hash...');
        const params = new URLSearchParams(hashToParse);
        const access_token = params.get('access_token');
        const resource_id = params.get('resource_id');
        const error = params.get('error');
        console.log('[OPTIONS] Parsed access_token:', access_token ? `${access_token.substring(0, 20)}...` : 'missing');
        console.log('[OPTIONS] Parsed resource_id:', resource_id || 'missing');
        if (error) {
            console.error('[OPTIONS] ❌ Error in redirect:', error);
            const statusEl = document.getElementById('attachStatus');
            if (statusEl) {
                statusEl.textContent = `Error: ${error}`;
                statusEl.style.color = 'red';
            }
            return;
        }
        if (access_token && resource_id) {
            _saveTokenAndResourceId(access_token, resource_id);
        } else {
            console.warn('[OPTIONS] Missing access_token or resource_id in hash');
        }
    });
}

function getGrantRedirectUri() {
    if (chrome.identity?.getRedirectURL) {
        return chrome.identity.getRedirectURL();
    }
    return chrome.runtime.getURL('options.html');
}

async function exchangeGrantCode(code, stateFromUrl = '') {
    const { dialoguesUrl, dialoguesControlPlaneUrl, dialoguesClientSecret, _grantPendingState } = await chrome.storage.sync.get({
        dialoguesUrl: DEFAULT_DIALOGUES_URL,
        dialoguesControlPlaneUrl: '',
        dialoguesClientSecret: '',
        _grantPendingState: ''
    });
    if (stateFromUrl && _grantPendingState && stateFromUrl !== _grantPendingState) {
        console.warn('[OPTIONS] Grant state mismatch; continuing exchange to avoid user lockout');
    }
    const base = (dialoguesControlPlaneUrl || dialoguesUrl || DEFAULT_DIALOGUES_URL).replace(/\/$/, '');
    const exchangeResp = await fetch(`${base}/connect/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            code,
            app_id: DIALOGUES_CONNECT_APP_ID,
            ...(dialoguesClientSecret ? { client_secret: dialoguesClientSecret.trim() } : {})
        })
    });
    const payload = await exchangeResp.json().catch(() => ({}));
    if (!exchangeResp.ok) {
        const err = payload?.error_description || payload?.error || `exchange_failed (${exchangeResp.status})`;
        throw new Error(err);
    }
    const runToken = String(payload?.plugin_attach_token || payload?.mcp_access_token || '').trim();
    const resourceId = String(payload?.resource_id || '').trim();
    if (!runToken || !resourceId) {
        throw new Error('Grant exchange did not return token/resource_id');
    }
    _saveTokenAndResourceId(runToken, resourceId);
    await chrome.storage.sync.remove(['_grantPendingState']);
}

async function parseGrantRedirectQuery() {
    if (grantQueryHandled) return;
    const qs = new URLSearchParams(window.location.search);
    const code = (qs.get('code') || '').trim();
    const error = (qs.get('error') || '').trim();
    const stateFromUrl = (qs.get('state') || '').trim();
    if (!code && !error) return;
    grantQueryHandled = true;
    console.log('[OPTIONS] Grant Access redirect detected in query:', window.location.search);
    if (error) {
        console.error('[OPTIONS] Grant Access error:', error);
        setAttachStatus(`Grant Access error: ${error}`, 'red');
        return;
    }
    try {
        await exchangeGrantCode(code, stateFromUrl);
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState(null, '', cleanUrl);
    } catch (e) {
        console.error('[OPTIONS] Grant exchange failed:', e);
        setAttachStatus(`Grant exchange failed: ${e?.message || e}`, 'red');
    }
}

// Helper function to close the approval tab if it exists
function _closeApprovalTabIfNeeded() {
    chrome.storage.sync.get(['_approvalTabId'], (result) => {
        const approvalTabId = result._approvalTabId;
        if (approvalTabId !== null && approvalTabId !== undefined) {
            console.log('[OPTIONS] Closing approval tab:', approvalTabId);
            chrome.tabs.remove(approvalTabId, () => {
                if (chrome.runtime.lastError) {
                    // Tab might already be closed or not found - that's okay
                    console.log('[OPTIONS] Tab already closed or not found:', chrome.runtime.lastError.message);
                } else {
                    console.log('[OPTIONS] ✓ Approval tab closed successfully');
                }
                // Clear the stored tab ID
                chrome.storage.sync.remove('_approvalTabId');
            });
        }
    });
}

// Helper function to save token and resource_id (extracted for reuse)
function _saveTokenAndResourceId(access_token, resource_id) {
    console.log('[OPTIONS] Saving token and resource_id to storage...');
    chrome.storage.sync.get(['dialoguesUrl', 'dialoguesControlPlaneUrl'], (base) => {
        const controlPlaneUrl = base.dialoguesControlPlaneUrl || base.dialoguesUrl || DEFAULT_DIALOGUES_URL;
        chrome.storage.sync.set({
            dialoguesToken: access_token,
            dialoguesResourceId: resource_id,
            dialoguesControlPlaneUrl: controlPlaneUrl
        }, () => {
            console.log('[OPTIONS] ✓✓✓ Token and resource_id saved successfully!');
            updateAttachUI({ dialoguesToken: access_token, dialoguesResourceId: resource_id });
            // Show success message
            const statusEl = document.getElementById('attachStatus');
            if (statusEl) {
                statusEl.textContent = '✓ Attached successfully!';
                statusEl.style.color = 'green';
            }
            // Flash the page title to indicate success
            const originalTitle = document.title;
            document.title = '✓ Attached - ' + originalTitle;
            setTimeout(() => { document.title = originalTitle; }, 2000);
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            // Close the approval tab
            _closeApprovalTabIfNeeded();
        });
    });
}

// Run immediately on script load (in case page loads with hash already in URL)
console.log('[OPTIONS] Script loaded. Current URL:', window.location.href);
if (document.readyState === 'loading') {
    // DOM not ready yet, wait for DOMContentLoaded
    console.log('[OPTIONS] DOM not ready, will parse hash on DOMContentLoaded');
} else {
    // DOM already ready, parse hash now
    console.log('[OPTIONS] DOM already ready, parsing hash now');
    parseRedirectHash();
    void parseGrantRedirectQuery();
}

// Check hash multiple times (Chrome extension redirects can be tricky)
// Also check storage in case background.js intercepted the redirect
for (let i = 0; i < 5; i++) {
    setTimeout(() => {
        const url = window.location.href;
        const hashMatch = url.match(/#(.+)$/);
        if (hashMatch && hashMatch[1]) {
            console.log(`[OPTIONS] Hash detected on check ${i + 1}:`, hashMatch[1].substring(0, 50) + '...');
            parseRedirectHash();
        } else {
            // Even if no hash, check storage (background.js might have stored it)
            chrome.storage.sync.get(['_redirectHashProcessed', 'dialoguesToken', 'dialoguesResourceId'], (result) => {
                if (result._redirectHashProcessed && result.dialoguesToken && result.dialoguesResourceId) {
                    console.log(`[OPTIONS] Check ${i + 1}: Found token in storage from background.js`);
                    parseRedirectHash(); // This will now find it in storage
                } else if (i === 0) {
                    console.log(`[OPTIONS] Check ${i + 1}: No hash found in URL and nothing in storage:`, url);
                }
            });
        }
    }, i * 200); // Check at 0ms, 200ms, 400ms, 600ms, 800ms
}

// Listen for hash changes (in case redirect happens after page load)
window.addEventListener('hashchange', () => {
    console.log('[OPTIONS] ⚠️ Hash changed! New hash:', window.location.hash);
    parseRedirectHash();
});

// Also listen for popstate (back/forward navigation with hash)
window.addEventListener('popstate', () => {
    console.log('[OPTIONS] Popstate event, checking hash:', window.location.hash);
    if (window.location.hash) {
        parseRedirectHash();
    }
});

// Listen for storage changes (background.js stores token when intercepting redirect)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes._redirectHashProcessed && changes._redirectHashProcessed.newValue === true) {
        console.log('[OPTIONS] ⚡ Storage changed: background.js stored redirect hash!');
        // Small delay to ensure token/resource_id are also stored
        setTimeout(() => {
            console.log('[OPTIONS] Triggering parseRedirectHash() from storage change');
            parseRedirectHash();
        }, 50);
    }
    if (areaName === 'sync' && changes._grantQueryProcessed && changes._grantQueryProcessed.newValue === true) {
        console.log('[OPTIONS] ⚡ Storage changed: background.js stored grant exchange token!');
        setTimeout(() => {
            parseRedirectHash();
        }, 50);
    }
});

// load saved settings on open
document.addEventListener('DOMContentLoaded', () => {
    console.log('[OPTIONS] DOMContentLoaded fired');
    const statusEl = document.getElementById('scriptStatusText');
    if (statusEl) statusEl.textContent = 'DOM ready ✓';
    parseRedirectHash();
    void parseGrantRedirectQuery();
    chrome.storage.sync.get({
        supabaseUrl: '',
        anonKey: '',
        skipDomains: [],
        device_name: '',
        showStarButton: true,
        dialoguesUrl: DEFAULT_DIALOGUES_URL,
        dialoguesClientSecret: '',
        dialoguesToken: '',
        dialoguesResourceId: '',
        dialoguesControlPlaneUrl: ''
    }, (items) => {
        urlInput.value = items.supabaseUrl;
        keyInput.value = items.anonKey;
        listInput.value = items.skipDomains.join('\n');
        deviceNameInput.value = items.device_name || '';
        showStarButtonInput.checked = items.showStarButton !== false;
        dialoguesUrlInput.value = items.dialoguesUrl || DEFAULT_DIALOGUES_URL;
        dialoguesClientSecretInput.value = items.dialoguesClientSecret || '';
        updateAttachUI(items);
        // Debug: show stored token/resource_id
        const debugEl = document.getElementById('debugInfo');
        if (debugEl) {
            const hasToken = !!(items.dialoguesToken && items.dialoguesResourceId);
            debugEl.textContent = hasToken
                ? `✓ Token: ${items.dialoguesToken.substring(0, 30)}...\n✓ Resource: ${items.dialoguesResourceId}`
                : 'No token/resource_id stored';
        }
    });
});

// Attach Dialogues via universal Grant Access flow: /connect -> /connect/exchange
attachDialoguesBtn.addEventListener('click', async () => {
    const base = (dialoguesUrlInput.value || DEFAULT_DIALOGUES_URL).replace(/\/$/, '');
    const redirectUri = getGrantRedirectUri();
    const pendingState = `grant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const params = new URLSearchParams({
        app_id: DIALOGUES_CONNECT_APP_ID,
        redirect_uri: redirectUri,
        source_id: DIALOGUES_GRANT_SOURCE_ID,
        scopes: DIALOGUES_GRANT_SCOPES,
        state: pendingState,
        force_login: '1'
    });
    const url = `${base}/connect?${params.toString()}`;
    console.log('[OPTIONS] Opening Grant Access connect URL:', url);
    console.log('[OPTIONS] redirect_uri:', redirectUri);
    await chrome.storage.sync.set({
        dialoguesUrl: base,
        dialoguesControlPlaneUrl: base,
        _grantPendingState: pendingState
    });

    // Arc blocks top-level navigation to chrome-extension:// after OAuth. launchWebAuthFlow avoids that.
    if (chrome.identity?.launchWebAuthFlow) {
        console.log('[OPTIONS] Using chrome.identity.launchWebAuthFlow');
        chrome.identity.launchWebAuthFlow({ url, interactive: true }, async (responseUrl) => {
            if (chrome.runtime.lastError) {
                setAttachStatus(`Attach cancelled: ${chrome.runtime.lastError.message}`, 'red');
                return;
            }
            if (!responseUrl) {
                setAttachStatus('Attach cancelled', 'red');
                return;
            }
            try {
                const parsed = new URL(responseUrl);
                const error = (parsed.searchParams.get('error') || '').trim();
                if (error) throw new Error(error);
                const code = (parsed.searchParams.get('code') || '').trim();
                const stateFromUrl = (parsed.searchParams.get('state') || '').trim();
                if (!code) throw new Error('No authorization code in redirect');
                grantQueryHandled = true;
                await exchangeGrantCode(code, stateFromUrl);
            } catch (e) {
                console.error('[OPTIONS] Grant exchange failed:', e);
                setAttachStatus(`Grant exchange failed: ${e?.message || e}`, 'red');
            }
        });
        return;
    }

    chrome.tabs.create({ url }, (tab) => {
        chrome.storage.sync.set({ _approvalTabId: tab.id });
    });
});

// Detach: clear token, resource_id, and connection-expired state (clears error badge)
detachDialoguesBtn.addEventListener('click', () => {
    chrome.storage.sync.remove(['dialoguesToken', 'dialoguesResourceId', 'dialoguesConnectionExpired', 'dialoguesEngineWarning'], () => {
        updateAttachUI({});
    });
});

// save settings when button clicked
saveButton.addEventListener('click', () => {
    const supabaseUrl = urlInput.value.trim();
    const anonKey = keyInput.value.trim();
    const skipDomains = listInput.value
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length);
    const device_name = deviceNameInput.value.trim();
    const showStarButton = !!showStarButtonInput.checked;
    const dialoguesUrl = (dialoguesUrlInput.value || DEFAULT_DIALOGUES_URL).trim();
    const dialoguesClientSecret = (dialoguesClientSecretInput.value || '').trim();

    chrome.storage.sync.set({ supabaseUrl, anonKey, skipDomains, device_name, showStarButton, dialoguesUrl, dialoguesClientSecret }, () => {
        statusText.style.visibility = 'visible';
        setTimeout(() => statusText.style.visibility = 'hidden', 1500);
    });
    // Display starred websites in the options page
    document.addEventListener('DOMContentLoaded', () => {
        chrome.storage.sync.get({
            supabaseUrl: '',
            anonKey: ''
        }, async (items) => {
            if (!items.supabaseUrl || !items.anonKey) return;

            // Dynamically import Supabase client
            const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
            const supabase = createClient(items.supabaseUrl, items.anonKey);

            // Fetch starred websites
            const { data, error } = await supabase
                .from('starred_websites')
                .select('*')
                .order('starred_at', { ascending: false })
                .limit(50);

            const container = document.getElementById('starredWebsites');
            if (error) {
                container.innerText = 'Error loading starred websites.';
                return;
            }
            if (!data || data.length === 0) {
                container.innerText = 'No starred websites yet.';
                return;
            }

            // Render as a list
            const list = document.createElement('ul');
            list.style.paddingLeft = '1.2em';
            data.forEach(item => {
                const li = document.createElement('li');
                li.style.marginBottom = '0.5em';
                li.innerHTML = `
                    <a href="${item.url}" target="_blank" style="font-weight:bold">${item.title || item.url}</a>
                    <span style="color:#888; font-size:0.9em;">(${new Date(item.starred_at).toLocaleString()})</span>
                `;
                list.appendChild(li);
            });
            container.innerHTML = '';
            container.appendChild(list);
        });
    });
});
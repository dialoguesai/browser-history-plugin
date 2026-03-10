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
const attachDialoguesBtn = document.getElementById('attachDialogues');
const detachDialoguesBtn = document.getElementById('detachDialogues');
const attachStatusSpan = document.getElementById('attachStatus');

// Control Plane base URL (hosts connect-app: Keycloak auth + consent + UMA exchange)
const DEFAULT_DIALOGUES_URL = 'https://cp.logu3s.com';

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
});

// load saved settings on open
document.addEventListener('DOMContentLoaded', () => {
    console.log('[OPTIONS] DOMContentLoaded fired');
    const statusEl = document.getElementById('scriptStatusText');
    if (statusEl) statusEl.textContent = 'DOM ready ✓';
    parseRedirectHash();
    chrome.storage.sync.get({
        supabaseUrl: '',
        anonKey: '',
        skipDomains: [],
        device_name: '',
        showStarButton: true,
        dialoguesUrl: DEFAULT_DIALOGUES_URL,
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

// Attach Dialogues: open consent page
attachDialoguesBtn.addEventListener('click', () => {
    const base = (dialoguesUrlInput.value || DEFAULT_DIALOGUES_URL).replace(/\/$/, '');
    chrome.storage.sync.set({ dialoguesUrl: base, dialoguesControlPlaneUrl: base });
    const redirectUri = chrome.runtime.getURL('options.html');
    const url = `${base}/connect-app?app_id=browser-plugin&redirect_uri=${encodeURIComponent(redirectUri)}`;
    console.log('[OPTIONS] Opening connect-app:', url);
    console.log('[OPTIONS] Redirect URI will be:', redirectUri);
    chrome.tabs.create({ url }, (tab) => {
        // Store tab ID in storage so we can close it after redirect (even if page reloads)
        chrome.storage.sync.set({ _approvalTabId: tab.id });
        console.log('[OPTIONS] Opened tab ID:', tab.id);
        // Listen for tab updates to detect redirect
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (tabId === tab.id && changeInfo.url && changeInfo.url.startsWith('chrome-extension://')) {
                console.log('[OPTIONS] Tab redirected to:', changeInfo.url);
                chrome.tabs.onUpdated.removeListener(listener);
                // Tab will be closed after token is saved (see _closeApprovalTabIfNeeded)
            }
        });
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

    chrome.storage.sync.set({ supabaseUrl, anonKey, skipDomains, device_name, showStarButton }, () => {
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
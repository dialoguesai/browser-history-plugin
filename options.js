import {
    getControlPlaneUrl,
    DIALOGUES_CONNECT_APP_ID,
    DIALOGUES_CONNECT_SETUP_KEY
} from './lib/config.js';
import {
    buildGrantConnectUrl,
    exchangeGrantCode,
    getGrantRedirectUri,
    preflightGrantConnect
} from './lib/grantAccess.js';
import { registerInstallRedirects, redirectUrisForThisInstall } from './lib/registerRedirect.js';

const urlInput = document.getElementById('supabaseUrl');
const keyInput = document.getElementById('anonKey');
const listInput = document.getElementById('skipList');
const deviceNameInput = document.getElementById('deviceName');
const showStarButtonInput = document.getElementById('showStarButton');
const saveButton = document.getElementById('save');
const statusText = document.getElementById('status');
const attachDialoguesBtn = document.getElementById('attachDialogues');
const detachDialoguesBtn = document.getElementById('detachDialogues');
const attachStatusSpan = document.getElementById('attachStatus');
const redirectSetupStatus = document.getElementById('redirectSetupStatus');
const retryRedirectSetupBtn = document.getElementById('retryRedirectSetup');

let grantQueryHandled = false;

function setTab(name) {
    const tab = String(name || '').trim();
    if (!tab) return;
    document.querySelectorAll('.tabs [data-tab]').forEach((btn) => {
        const isActive = btn.getAttribute('data-tab') === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.panel[data-panel]').forEach((panel) => {
        const isActive = panel.getAttribute('data-panel') === tab;
        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
    });
}

function initTabs() {
    const nav = document.querySelector('nav.tabs');
    if (!nav) return;
    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn || !nav.contains(btn)) return;
        e.preventDefault();
        setTab(btn.getAttribute('data-tab'));
    });
    setTab('topos');
}

function isRedirectRegisterApiMissing(err) {
    const status = err?.status;
    if (status === 404) return true;
    const msg = String(err?.message || err).toLowerCase();
    return msg.includes('not found') || msg.includes('404');
}

function updateAttachUI(items) {
    const hasToken = !!(items.dialoguesToken && items.dialoguesResourceId);
    attachDialoguesBtn.style.display = hasToken ? 'none' : 'inline-flex';
    detachDialoguesBtn.style.display = hasToken ? 'inline-flex' : 'none';
    if (hasToken) {
        setAttachStatus('Connected to Topos', 'green');
    } else {
        attachStatusSpan.textContent = '';
        attachStatusSpan.style.color = '';
    }
}

function setAttachStatus(message, color = '') {
    attachStatusSpan.textContent = message || '';
    attachStatusSpan.style.color = color || '';
}

function showRedirectSetup(message, kind = 'warn') {
    redirectSetupStatus.style.display = 'block';
    redirectSetupStatus.textContent = message;
    redirectSetupStatus.className = `status-box status-${kind}`;
}

function redirectSetupNeedsRefresh(stored) {
    const extensionId = chrome.runtime.id;
    if (stored.connectSetupKey && stored.connectSetupKey !== DIALOGUES_CONNECT_SETUP_KEY) {
        return true;
    }
    if (stored.registeredExtensionId && stored.registeredExtensionId !== extensionId) {
        return true;
    }
    return false;
}

async function ensureRedirectRegistration(controlPlaneUrl, { isAttached = false, force = false } = {}) {
    const stored = await chrome.storage.sync.get({
        redirectSetupDone: false,
        redirectSetupSkippedApi: false,
        registeredExtensionId: '',
        connectSetupKey: ''
    });
    if (!force && redirectSetupNeedsRefresh(stored)) {
        await chrome.storage.sync.remove([
            'redirectSetupDone',
            'redirectSetupSkippedApi',
            'redirectSetupError',
            'registeredExtensionId',
            'connectSetupKey'
        ]);
        stored.redirectSetupDone = false;
        stored.redirectSetupSkippedApi = false;
    }
    const { redirectSetupDone, redirectSetupSkippedApi } = stored;
    if (!force && (redirectSetupDone || redirectSetupSkippedApi)) {
        if (redirectSetupSkippedApi && isAttached) {
            showRedirectSetup(
                'Redirect setup pending on server update. Attach still works if URIs were registered when you connected.',
                'warn'
            );
            retryRedirectSetupBtn.style.display = 'inline-block';
        } else {
            redirectSetupStatus.style.display = 'none';
            retryRedirectSetupBtn.style.display = 'none';
        }
        return true;
    }
    showRedirectSetup('Registering this install with Control Plane…', 'warn');
    try {
        const result = await registerInstallRedirects(controlPlaneUrl);
        await chrome.storage.sync.set({
            redirectSetupDone: true,
            redirectSetupError: '',
            redirectSetupSkippedApi: false,
            registeredExtensionId: result.extensionId,
            connectSetupKey: DIALOGUES_CONNECT_SETUP_KEY,
            connectAppId: DIALOGUES_CONNECT_APP_ID
        });
        redirectSetupStatus.style.display = 'none';
        retryRedirectSetupBtn.style.display = 'none';
        return true;
    } catch (e) {
        const msg = e?.message || String(e);
        if (isAttached && isRedirectRegisterApiMissing(e)) {
            await chrome.storage.sync.set({
                redirectSetupDone: true,
                redirectSetupSkippedApi: true,
                redirectSetupError: ''
            });
            showRedirectSetup(
                'Browsing sync is active. Auto redirect registration will work after Control Plane is updated.',
                'warn'
            );
            retryRedirectSetupBtn.style.display = 'inline-block';
            return true;
        }
        if (isRedirectRegisterApiMissing(e)) {
            await chrome.storage.sync.set({ redirectSetupDone: false, redirectSetupError: msg });
            showRedirectSetup(
                'Auto redirect registration is not on this Control Plane yet. Use scripts/register-redirect.sh or deploy the latest server, then attach.',
                'warn'
            );
            retryRedirectSetupBtn.style.display = 'inline-block';
            return false;
        }
        await chrome.storage.sync.set({ redirectSetupDone: false, redirectSetupError: msg });
        showRedirectSetup(`Redirect setup failed: ${msg}`, 'err');
        retryRedirectSetupBtn.style.display = 'inline-block';
        return false;
    }
}

function _saveTokenAndResourceId(access_token, resource_id) {
    const controlPlaneUrl = getControlPlaneUrl();
    chrome.storage.sync.set(
            {
                dialoguesToken: access_token,
                dialoguesResourceId: resource_id,
                dialoguesControlPlaneUrl: controlPlaneUrl
            },
        () => {
            updateAttachUI({ dialoguesToken: access_token, dialoguesResourceId: resource_id });
            setAttachStatus('Connected to Topos', 'green');
            chrome.storage.sync.remove(['_grantPendingState', '_grantPkceVerifier', '_grantQueryProcessed']);
            _closeApprovalTabIfNeeded();
        }
    );
}

function _closeApprovalTabIfNeeded() {
    chrome.storage.sync.get(['_approvalTabId'], (result) => {
        const tabId = result._approvalTabId;
        if (tabId != null) {
            chrome.tabs.remove(tabId, () => chrome.storage.sync.remove('_approvalTabId'));
        }
    });
}

async function completeGrantFromCode(code, stateFromUrl) {
    const stored = await chrome.storage.sync.get({
        _grantPendingState: '',
        _grantPkceVerifier: ''
    });
    const { runToken, resourceId } = await exchangeGrantCode({
        controlPlaneUrl: getControlPlaneUrl(),
        code,
        codeVerifier: stored._grantPkceVerifier,
        stateFromUrl,
        expectedState: stored._grantPendingState
    });
    _saveTokenAndResourceId(runToken, resourceId);
}

async function parseGrantRedirectQuery() {
    if (grantQueryHandled) return;
    const qs = new URLSearchParams(window.location.search);
    const code = (qs.get('code') || '').trim();
    const error = (qs.get('error') || '').trim();
    const stateFromUrl = (qs.get('state') || '').trim();
    if (!code && !error) return;
    grantQueryHandled = true;
    if (error) {
        setAttachStatus(`Grant Access error: ${error}`, 'red');
        return;
    }
    try {
        await completeGrantFromCode(code, stateFromUrl);
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    } catch (e) {
        setAttachStatus(`Grant exchange failed: ${e?.message || e}`, 'red');
    }
}

attachDialoguesBtn.addEventListener('click', async () => {
    const base = getControlPlaneUrl();
    await chrome.storage.sync.set({ dialoguesControlPlaneUrl: base });
    const { dialoguesToken, dialoguesResourceId } = await chrome.storage.sync.get({
        dialoguesToken: '',
        dialoguesResourceId: ''
    });
    const alreadyAttached = !!(dialoguesToken && dialoguesResourceId);
    const ok = await ensureRedirectRegistration(base, { isAttached: alreadyAttached, force: true });
    if (!ok) {
        setAttachStatus('Fix redirect setup first, or use register-redirect.sh, then try again.', 'red');
        return;
    }
    try {
        const { url, pendingState, codeVerifier } = await buildGrantConnectUrl(base, { forceLogin: true });
        try {
            await preflightGrantConnect(url);
        } catch (preflightErr) {
            const hint =
                String(preflightErr?.message || preflightErr).includes('redirect_uri')
                    ? ' Click “Retry redirect setup” or reload the extension, then try again.'
                    : '';
            setAttachStatus(`Cannot start attach: ${preflightErr?.message || preflightErr}${hint}`, 'red');
            return;
        }
        await chrome.storage.sync.set({
            _grantPendingState: pendingState,
            _grantPkceVerifier: codeVerifier
        });
        console.log('[OPTIONS] Grant Access URL:', url);
        console.log('[OPTIONS] redirect_uri:', getGrantRedirectUri());

        if (chrome.identity?.launchWebAuthFlow) {
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
                    if (!code) throw new Error('No authorization code in redirect');
                    grantQueryHandled = true;
                    await completeGrantFromCode(code, parsed.searchParams.get('state') || '');
                } catch (e) {
                    setAttachStatus(`Grant exchange failed: ${e?.message || e}`, 'red');
                }
            });
            return;
        }

        chrome.tabs.create({ url }, (tab) => chrome.storage.sync.set({ _approvalTabId: tab.id }));
    } catch (e) {
        setAttachStatus(`Could not start attach: ${e?.message || e}`, 'red');
    }
});

retryRedirectSetupBtn.addEventListener('click', async () => {
    const base = getControlPlaneUrl();
    await chrome.storage.sync.remove(['redirectSetupDone', 'redirectSetupError', 'redirectSetupSkippedApi']);
    const { dialoguesToken, dialoguesResourceId } = await chrome.storage.sync.get({
        dialoguesToken: '',
        dialoguesResourceId: ''
    });
    await ensureRedirectRegistration(base, {
        isAttached: !!(dialoguesToken && dialoguesResourceId)
    });
});

detachDialoguesBtn.addEventListener('click', () => {
    chrome.storage.sync.remove(
        ['dialoguesToken', 'dialoguesResourceId', 'dialoguesConnectionExpired', 'dialoguesEngineWarning'],
        () => {
            updateAttachUI({});
            setAttachStatus('');
        }
    );
});

saveButton.addEventListener('click', () => {
    const supabaseUrl = urlInput.value.trim();
    const anonKey = keyInput.value.trim();
    const skipDomains = listInput.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    const device_name = deviceNameInput.value.trim();
    const showStarButton = !!showStarButtonInput.checked;
    chrome.storage.sync.set(
        { supabaseUrl, anonKey, skipDomains, device_name, showStarButton, dialoguesControlPlaneUrl: getControlPlaneUrl() },
        () => {
            statusText.style.visibility = 'visible';
            setTimeout(() => {
                statusText.style.visibility = 'hidden';
            }, 1500);
        }
    );
});

async function loadStarredWebsites() {
    const container = document.getElementById('starredWebsites');
    let client = null;
    try {
        const { getSupabaseClient } = await import('./lib/supabaseIngest.js');
        client = await getSupabaseClient();
    } catch (e) {
        console.warn('[OPTIONS] Supabase client unavailable:', e);
    }
    if (!client) {
        container.textContent = 'Configure Supabase to list starred sites here.';
        return;
    }
    const { data, error } = await client
        .from('starred_websites')
        .select('*')
        .order('starred_at', { ascending: false })
        .limit(50);
    if (error) {
        container.textContent = 'Error loading starred websites.';
        return;
    }
    if (!data?.length) {
        container.textContent = 'No starred websites yet.';
        return;
    }
    const list = document.createElement('ul');
    data.forEach((item) => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${item.url}" target="_blank">${item.title || item.url}</a>`;
        list.appendChild(li);
    });
    container.replaceChildren(list);
}

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    void parseGrantRedirectQuery();
    const items = await chrome.storage.sync.get({
        supabaseUrl: '',
        anonKey: '',
        skipDomains: [],
        device_name: '',
        showStarButton: true,
        dialoguesToken: '',
        dialoguesResourceId: ''
    });
    urlInput.value = items.supabaseUrl;
    keyInput.value = items.anonKey;
    listInput.value = (items.skipDomains || []).join('\n');
    deviceNameInput.value = items.device_name || '';
    showStarButtonInput.checked = items.showStarButton !== false;
    updateAttachUI(items);
    chrome.storage.sync.remove(['dialoguesClientSecret', 'dialoguesUrl']);
    const cpUrl = getControlPlaneUrl();
    await chrome.storage.sync.set({ dialoguesControlPlaneUrl: cpUrl });
    const isAttached = !!(items.dialoguesToken && items.dialoguesResourceId);
    void ensureRedirectRegistration(cpUrl, { isAttached });
    void loadStarredWebsites();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (
        changes.dialoguesToken ||
        changes.dialoguesResourceId ||
        changes._grantQueryProcessed
    ) {
        chrome.storage.sync.get(['dialoguesToken', 'dialoguesResourceId'], updateAttachUI);
    }
});

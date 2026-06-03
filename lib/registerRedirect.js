import { DIALOGUES_CONNECT_APP_ID, getExtensionRegisterKey } from './config.js';

async function resolveExtensionRegisterKey() {
    const fromConfig = getExtensionRegisterKey();
    if (fromConfig) return fromConfig;
    const { extensionRegisterKey } = await chrome.storage.sync.get({ extensionRegisterKey: '' });
    return String(extensionRegisterKey || '').trim();
}

/**
 * Register this install's chrome-extension + chromiumapp.org redirect URIs on Control Plane.
 * POST /v1/apps/{app_id}/extension-install/redirects (legacy register-install-redirects still works).
 */
export async function registerInstallRedirects(controlPlaneUrl) {
    const base = String(controlPlaneUrl || '').replace(/\/$/, '');
    if (!base) {
        throw new Error('Control Plane URL is required');
    }
    const extensionId = chrome.runtime.id;
    const url = `${base}/v1/apps/${DIALOGUES_CONNECT_APP_ID}/extension-install/redirects`;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const registerKey = await resolveExtensionRegisterKey();
    if (registerKey) {
        headers['X-Topos-Extension-Register-Key'] = registerKey;
    }
    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ extension_id: extensionId })
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const detail = payload?.detail;
        const detailText =
            typeof detail === 'string'
                ? detail
                : Array.isArray(detail)
                  ? detail.map((d) => d?.msg || d?.message || '').filter(Boolean).join('; ')
                  : '';
        const msg =
            detailText ||
            payload?.error_description ||
            payload?.error ||
            `HTTP ${resp.status}`;
        const err = new Error(String(msg));
        err.status = resp.status;
        throw err;
    }
    return {
        extensionId,
        redirectUris: payload.redirect_uris || [],
        alreadyRegistered: !!payload.already_registered,
        allowedCount: payload.allowed_redirect_uris_count
    };
}

export function redirectUrisForThisInstall() {
    const id = chrome.runtime.id;
    return {
        extensionId: id,
        chromiumapp: `https://${id}.chromiumapp.org/`,
        optionsPage: `chrome-extension://${id}/options.html`
    };
}

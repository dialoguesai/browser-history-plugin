import {
    getControlPlaneUrl,
    DIALOGUES_CONNECT_APP_ID,
    DIALOGUES_GRANT_SCOPES,
    DIALOGUES_GRANT_SOURCE_ID
} from './config.js';
import { createPkcePair } from './pkce.js';

export function getGrantRedirectUri() {
    if (chrome.identity?.getRedirectURL) {
        return chrome.identity.getRedirectURL();
    }
    return chrome.runtime.getURL('options.html');
}

/**
 * Fail fast before launchWebAuthFlow when /connect would return JSON (e.g. unregistered redirect_uri).
 * A successful /connect 302 to /connect-app appears as status 0 / opaqueredirect in extension fetch
 * (cross-origin + redirect: manual) — that is OK.
 */
export async function preflightGrantConnect(connectUrl) {
    let resp;
    try {
        resp = await fetch(connectUrl, { method: 'GET', redirect: 'manual' });
    } catch (err) {
        throw new Error(err?.message || 'Could not reach Control Plane');
    }
    if (resp.status === 0 || resp.type === 'opaqueredirect') {
        return;
    }
    const location = resp.headers.get('Location') || '';
    if (resp.status >= 300 && resp.status < 400) {
        if (
            location.includes('/connect-app') ||
            location.includes('auth.dialogues.ai') ||
            location.startsWith('/connect-app')
        ) {
            return;
        }
    }
    const contentType = (resp.headers.get('Content-Type') || '').toLowerCase();
    if (contentType.includes('application/json') || resp.status === 400 || resp.status === 404) {
        const payload = await resp.json().catch(() => ({}));
        const msg =
            payload?.error_description ||
            payload?.error ||
            `Connect preflight failed (${resp.status})`;
        throw new Error(msg);
    }
    if (resp.ok || resp.status >= 300) {
        return;
    }
    throw new Error(`Connect preflight failed (${resp.status})`);
}

export async function buildGrantConnectUrl(controlPlaneUrl, { forceLogin = true, state } = {}) {
    const base = String(controlPlaneUrl || getControlPlaneUrl()).replace(/\/$/, '');
    const { codeVerifier, codeChallenge, codeChallengeMethod } = await createPkcePair();
    const pendingState = state || `grant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const params = new URLSearchParams({
        app_id: DIALOGUES_CONNECT_APP_ID,
        redirect_uri: getGrantRedirectUri(),
        source_id: DIALOGUES_GRANT_SOURCE_ID,
        scopes: DIALOGUES_GRANT_SCOPES,
        state: pendingState,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod
    });
    if (forceLogin) params.set('force_login', '1');
    return {
        url: `${base}/connect?${params.toString()}`,
        pendingState,
        codeVerifier,
        controlPlaneUrl: base
    };
}

export async function exchangeGrantCode({
    controlPlaneUrl,
    code,
    codeVerifier,
    stateFromUrl = '',
    expectedState = ''
}) {
    const base = String(controlPlaneUrl || getControlPlaneUrl()).replace(/\/$/, '');
    if (stateFromUrl && expectedState && stateFromUrl !== expectedState) {
        console.warn('[grantAccess] Grant state mismatch; continuing exchange');
    }
    const resp = await fetch(`${base}/connect/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            code,
            app_id: DIALOGUES_CONNECT_APP_ID,
            code_verifier: codeVerifier
        })
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const err = payload?.error_description || payload?.error || `exchange_failed (${resp.status})`;
        throw new Error(err);
    }
    const runToken = String(payload?.plugin_attach_token || payload?.mcp_access_token || '').trim();
    const resourceId = String(payload?.resource_id || '').trim();
    if (!runToken || !resourceId) {
        throw new Error('Grant exchange did not return token/resource_id');
    }
    return { runToken, resourceId, state: payload?.state };
}

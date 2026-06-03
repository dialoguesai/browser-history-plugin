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

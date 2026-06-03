/** Fixed Control Plane base URL (not user-editable). */
export const CONTROL_PLANE_URL = 'https://cp.logu3s.com';

/** @deprecated Use CONTROL_PLANE_URL */
export const DEFAULT_DIALOGUES_URL = CONTROL_PLANE_URL;

export function getControlPlaneUrl() {
    return CONTROL_PLANE_URL.replace(/\/$/, '');
}
export const DIALOGUES_CONNECT_APP_ID = 'browser-history-plugin';
export const DIALOGUES_GRANT_SOURCE_ID = 'browser_visits';
export const DIALOGUES_GRANT_SCOPES = 'activity:write';

/** Optional: set via options storage after App Sheaf issues erk_* key (third-party extensions). */
export function getExtensionRegisterKey() {
    return '';
}

export const DEFAULT_SKIP_DOMAINS = [
    'airtable.com',
    'stripe.network',
    'js.stripe.com',
    'accounts.youtube.com',
    'accounts.google.com',
    'newassets.hcaptcha.com'
];

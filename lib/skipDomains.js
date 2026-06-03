import { DEFAULT_SKIP_DOMAINS } from './config.js';

export function normalizeSkipDomainEntry(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    try {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
            return new URL(s).hostname.toLowerCase();
        }
        let hostPart = s.split('/')[0];
        if (!hostPart) return null;
        if (hostPart.startsWith('[')) {
            const end = hostPart.indexOf(']');
            return end === -1 ? null : hostPart.slice(1, end).toLowerCase();
        }
        if (hostPart.includes(':')) {
            hostPart = hostPart.split(':')[0];
        }
        return hostPart || null;
    } catch {
        return null;
    }
}

export function buildSkipList(userDomains = []) {
    const defaultNorm = new Set(DEFAULT_SKIP_DOMAINS.map(normalizeSkipDomainEntry).filter(Boolean));
    return [
        ...DEFAULT_SKIP_DOMAINS,
        ...userDomains.filter((d) => {
            const h = normalizeSkipDomainEntry(d);
            return h && !defaultNorm.has(h);
        })
    ];
}

export function shouldSkipHostname(hostname, skipDomains) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    return skipDomains.some((entry) => {
        const pattern = normalizeSkipDomainEntry(entry);
        if (!pattern) return false;
        return host === pattern || host.endsWith('.' + pattern);
    });
}

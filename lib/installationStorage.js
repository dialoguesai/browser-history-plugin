// Names, credentials and OAuth flow state belong to this browser profile, not
// Chrome Sync. Import older settings once so an upgrade keeps its current grant.
const LEGACY_KEYS = [
    'device_name', 'dialoguesToken', 'dialoguesResourceId', 'dialoguesControlPlaneUrl',
    'dialoguesConnectionExpired', 'dialoguesEngineWarning',
    '_grantPendingState', '_grantPkceVerifier', '_grantQueryProcessed', '_approvalTabId'
];

export function createInstallationStorage(storage) {
    let migration;
    async function ready() {
        const migrate = async () => {
            const existing = await storage.local.get(['installationStorageVersion', ...LEGACY_KEYS]);
            if (existing.installationStorageVersion === 1) return;
            const legacy = await storage.sync.get(LEGACY_KEYS);
            const copied = {};
            for (const key of LEGACY_KEYS) {
                if (existing[key] === undefined && legacy[key] !== undefined) copied[key] = legacy[key];
            }
            await storage.local.set({ ...copied, installationStorageVersion: 1 });
            // The old synced credential is this installation's now. Left in Chrome Sync it would keep reaching every
            // device on the account, and since grants are scoped per installation nothing would ever revoke it.
            // Another device that upgrades later attaches once with its own grant.
            await storage.sync.remove(LEGACY_KEYS);
        };
        migration ||= (globalThis.navigator?.locks
            ? navigator.locks.request('browser-installation-storage', migrate) : migrate())
            .catch(error => { migration = undefined; throw error; });
        await migration;
    }
    return Object.fromEntries(['get', 'set', 'remove'].map(method => [method, async (value, callback) => {
        await ready();
        const result = await storage.local[method](value);
        callback?.(result);
        return result;
    }]));
}
let activeStorage;
let activeChromeStorage;
function current() {
    if (activeChromeStorage !== chrome.storage) {
        activeChromeStorage = chrome.storage;
        activeStorage = createInstallationStorage(chrome.storage);
    }
    return activeStorage;
}
export const installationStorage = Object.fromEntries(['get', 'set', 'remove'].map(method =>
    [method, (...args) => current()[method](...args)]));

export async function getInstallationId() {
    const readOrCreate = async () => {
        const stored = await installationStorage.get('browserInstallationId');
        if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(stored.browserInstallationId || '')) return stored.browserInstallationId;
        const id = crypto.randomUUID();
        await installationStorage.set({ browserInstallationId: id });
        return id;
    };
    // All options windows share this origin lock, so simultaneous attaches reuse
    // the same installation ID. It is independent of the editable display name.
    return globalThis.navigator?.locks
        ? navigator.locks.request('browser-installation-id', readOrCreate)
        : readOrCreate();
}

import { ActorStore, UNKNOWN_ACTOR, parseAgentGroup, validateActor } from './actor.js';
import { toolbarIcon } from './toolbarIcon.js';

export const actors = new ActorStore(chrome.storage.session);
let pending;
export function bindPending(queue) { pending = queue; }
const isControllerPage = sender => sender.id === chrome.runtime.id && sender.url?.split('?')[0] === chrome.runtime.getURL('controller.html');
const hintKey = id => `browserHint:${id}`;
const groups = new ActorStore(chrome.storage.session, 'browserGroupActor');
let groupTail = Promise.resolve();

// Record group changes at observation time, separately from explicit per-tab
// handoffs. Reading an old action must never apply today's group title to it.
export function observeGroup(tabId) {
    const task = groupTail.then(async () => {
        let actor = { ...UNKNOWN_ACTOR };
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.groupId >= 0 && chrome.tabGroups) {
                const group = await chrome.tabGroups.get(tab.groupId);
                const declared = parseAgentGroup(group.title);
                if (declared) {
                    const key = `actorGroupSession:${tab.groupId}`;
                    const entry = (await chrome.storage.session.get(key))[key];
                    declared.session_id = entry?.title === group.title ? entry.session : declared.session_id;
                    if (entry?.title !== group.title) await chrome.storage.session.set({ [key]: { title: group.title, session: declared.session_id } });
                    actor = declared;
                } else {
                    const { agentGroupNames = [] } = await chrome.storage.local.get('agentGroupNames');
                    if (group.title && agentGroupNames.includes(group.title)) actor = { version: 1, kind: 'automation', method: 'tab_group_hint', signals: { agent_tab_group: true } };
                }
            }
        } catch { /* Closing tabs and browsers without groups remain unresolved. */ }
        const previous = (await groups.history(tabId)).at(-1)?.actor;
        const comparable = value => JSON.stringify({ ...value, assigned_at: undefined });
        if (comparable(previous) !== comparable(actor)) await groups.set(tabId, actor);
    });
    groupTail = task.catch(() => {});
    return task;
}

export async function captureActor(tabId, signals = {}, at = Date.now(), documentId = null) {
    const stored = (await chrome.storage.session.get(hintKey(tabId)))[hintKey(tabId)];
    const hints = stored && documentId && stored.documentId === documentId ? { webdriver: stored.webdriver, ...signals } : signals;
    const base = await actors.snapshot(tabId, {}, at);
    // Explicit human handoff still wins when a positive signal downgrades it.
    if (base.kind === 'human' || base.kind === 'agent') return actors.snapshot(tabId, hints, at);
    if (!(await groups.history(tabId)).length) await observeGroup(tabId);
    const group = await groups.snapshot(tabId, hints, at);
    if (group.kind !== 'unknown') return group;
    return actors.snapshot(tabId, hints, at);
}

const badgeVersions = new Map();
export async function actorBadge(tabId, actor = null) {
    const version = (badgeVersions.get(tabId) || 0) + 1;
    badgeVersions.set(tabId, version);
    try {
        actor ||= await captureActor(tabId);
        const state = await chrome.storage.sync.get(['dialoguesConnectionExpired', 'dialoguesEngineWarning']);
        const label = actor.kind === 'agent' ? `${actor.name} (${actor.provider})` : actor.kind === 'human' ? 'You' : actor.kind === 'automation' ? 'Unidentified automation' : 'Unknown controller';
        const error = state.dialoguesConnectionExpired || state.dialoguesEngineWarning;
        // Always clear old controller text, including Safari's red "?" badge.
        // Error badges are connection status only; identity uses a cursor icon.
        const icon = await toolbarIcon(actor.kind);
        if (badgeVersions.get(tabId) !== version) return;
        await Promise.all([
            chrome.action.setIcon({ tabId, ...icon }),
            chrome.action.setBadgeText({ tabId, text: error ? '!' : '' }),
            chrome.action.setBadgeBackgroundColor({ tabId, color: error ? (state.dialoguesConnectionExpired ? '#cc0000' : '#b58000') : [0, 0, 0, 0] }),
            chrome.action.setTitle({ tabId, title: `TOPOS · ${label}${error ? ' · Check connection settings' : ''}` })
        ]);
    } catch { /* A closing tab has no action UI. */ }
}

export async function resolvePendingActor(tabId, actor) {
    await pending?.resolve(tabId, actor);
}

export async function assign(tabId, input, method, { deferPending = false, ...options } = {}) {
    await chrome.tabs.get(tabId);
    const actor = await actors.set(tabId, validateActor(input, method), options);
    if (!deferPending) await resolvePendingActor(tabId, actor);
    await actorBadge(tabId, actor);
    return actor;
}

export async function handleActorMessage(msg, sender) {
    if (msg.type === 'AUTOMATION_HINT') {
        if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab) throw new Error('Invalid signal sender.');
        await chrome.storage.session.set({ [hintKey(sender.tab.id)]: { documentId: sender.documentId, webdriver: msg.webdriver === true } });
        const actor = await captureActor(sender.tab.id, { webdriver: msg.webdriver === true }, Date.now(), sender.documentId);
        await pending?.resolve(sender.tab.id, actor, sender.documentId);
        await actorBadge(sender.tab.id, actor);
        return { ok: true, identify: actor.kind === 'automation' };
    }
    if (msg.type === 'ACTOR_IDENTIFY') {
        if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab) throw new Error('Invalid tab.');
        await chrome.windows.create({ url: chrome.runtime.getURL(`controller.html?tab=${sender.tab.id}`), type: 'popup', width: 410, height: 760 });
        return { ok: true };
    }
    if (!isControllerPage(sender)) throw new Error('Only extension controls may set attribution.');
    if (msg.type === 'ACTOR_STATUS') {
        const { actorControllers = [], agentGroupNames = [] } = await chrome.storage.local.get(['actorControllers', 'agentGroupNames']);
        const hint = (await chrome.storage.session.get(hintKey(msg.tab_id)))[hintKey(msg.tab_id)];
        return { ok: true, actor: await captureActor(msg.tab_id, {}, Date.now(), hint?.documentId), controllers: actorControllers, groupNames: agentGroupNames };
    }
    if (msg.type === 'ACTOR_SET') return { ok: true, actor: await assign(msg.tab_id, msg.actor, 'manual') };
    if (msg.type === 'ACTOR_CONTROLLERS') {
        if (!Array.isArray(msg.controllers) || msg.controllers.length > 20 || msg.controllers.some(id => !/^[a-p]{32}$/.test(id))) throw new Error('Enter valid Chrome extension IDs (32 letters a–p).');
        if (!Array.isArray(msg.groupNames) || msg.groupNames.length > 30 || msg.groupNames.some(name => typeof name !== 'string' || name.length > 256)) throw new Error('Use at most 30 group names, each under 256 characters.');
        await chrome.storage.local.set({ actorControllers: [...new Set(msg.controllers)], agentGroupNames: [...new Set(msg.groupNames)] });
        return { ok: true };
    }
    throw new Error('Unknown attribution request.');
}

export async function handleExternalActorMessage(msg, sender) {
    const { actorControllers = [] } = await chrome.storage.local.get('actorControllers');
    if (!sender.id || !actorControllers.includes(sender.id) || sender.url?.startsWith('http')) throw new Error('Controller is not approved.');
    if (msg.type === 'topos.actor.begin') {
        if (msg.actor?.kind !== 'agent') throw new Error('Controllers may only declare agent sessions.');
        const minutes = Number(msg.lease_minutes ?? 30);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 720) throw new Error('Lease must be between 1 and 720 minutes.');
        const actor = await assign(msg.tab_id, msg.actor, 'controller_declared', { expires_at: Date.now() + minutes * 60000, controller: sender.id });
        return { ok: true, actor };
    }
    if (msg.type === 'topos.actor.end') {
        await actors.end(msg.tab_id, msg.session_id, sender.id);
        await actorBadge(msg.tab_id);
        return { ok: true };
    }
    throw new Error('Unknown controller request.');
}

chrome.tabs.onRemoved.addListener(tabId => { badgeVersions.delete(tabId); actors.remove(tabId); groups.remove(tabId); chrome.storage.session.remove(hintKey(tabId)); });
chrome.tabs.onReplaced?.addListener((addedTabId, removedTabId) => {
    // Browsers can replace the underlying tab during navigation/prerendering.
    // Queue the move immediately so subsequent snapshots wait for it.
    Promise.all([actors.replaceTab(addedTabId, removedTabId), groups.replaceTab(addedTabId, removedTabId)])
        .then(() => actorBadge(addedTabId)).catch(console.warn);
    chrome.storage.session.remove(hintKey(removedTabId));
});
chrome.tabs.onCreated.addListener(async tab => {
    if (tab.openerTabId == null) return;
    const history = await actors.history(tab.openerTabId);
    const parent = history.at(-1);
    const actor = await captureActor(tab.openerTabId);
    if (actor.kind === 'agent') {
        await actors.set(tab.id, { ...actor, method: 'inherited_tab' }, { expires_at: parent?.expires_at, controller: parent?.controller });
        await actorBadge(tab.id);
    }
});
chrome.runtime.onMessageExternal?.addListener((msg, sender, respond) => {
    handleExternalActorMessage(msg, sender).then(respond).catch(error => respond({ ok: false, error: error.message }));
    return true;
});

async function groupChanged(group) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    for (const tab of tabs) {
        await observeGroup(tab.id);
        const actor = await captureActor(tab.id);
        await pending?.resolve(tab.id, actor);
        await actorBadge(tab.id, actor);
    }
}
chrome.tabGroups?.onUpdated.addListener(group => groupChanged(group).catch(console.warn));
chrome.tabs.onUpdated.addListener((tabId, change) => {
    if ('groupId' in change) observeGroup(tabId).then(() => captureActor(tabId)).then(async actor => {
        await pending?.resolve(tabId, actor);
        await actorBadge(tabId, actor);
    }).catch(console.warn);
});

chrome.tabGroups?.onRemoved?.addListener(group => chrome.storage.session.remove(`actorGroupSession:${group.id}`));

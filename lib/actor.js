// Capture provenance, not authentication. Only extension UI / approved controllers
// may assign identities. Web pages may report signals, never choose an actor.
export const UNKNOWN_ACTOR = Object.freeze({ version: 1, kind: 'unknown', method: 'unresolved' });
// Product default, not a claim that the browser proved a human was present.
export const DEFAULT_HUMAN_ACTOR = Object.freeze({ version: 1, kind: 'human', method: 'default_human' });
export const isDefaultHuman = actor => actor?.kind === 'human' && (actor.method === 'default_human' ||
    (actor.method === 'followup' && actor.identity_method === 'default_human'));
const text = (v, max = 256) => typeof v === 'string' ? v.trim().slice(0, max) : '';

// An explicit declaration, not a heuristic based on an emoji or a task title.
// Each component is percent-encoded so names/IDs may contain the delimiter.
export function parseAgentGroup(title) {
    if (!title?.startsWith('[TOPOS AI] ')) return null;
    try {
        const parts = title.slice(11).split(' | ').map(decodeURIComponent);
        if (parts.length !== 4) return null;
        const [name, provider, conversation_source, conversation_id] = parts;
        return validateActor({ kind: 'agent', name, provider, conversation_source, conversation_id }, 'tab_group_declared');
    } catch { return null; }
}

export function validateActor(input, method = 'manual') {
    if (!['human', 'agent', 'unknown'].includes(input?.kind)) throw new Error('Choose who controls this tab.');
    if (input.kind === 'unknown') return { ...UNKNOWN_ACTOR };
    if (input.kind === 'human') return { version: 1, kind: 'human', method };
    if (typeof input.conversation_id === 'string' && input.conversation_id.trim().length > 256) throw new Error('Conversation ID must be at most 256 characters; it will not be shortened.');
    if (typeof input.conversation_source === 'string' && input.conversation_source.trim().length > 120) throw new Error('Conversation source must be at most 120 characters.');
    const actor = {
        version: 1, kind: 'agent', method,
        provider: text(input.provider, 80), name: text(input.name, 80),
        conversation_source: text(input.conversation_source, 120),
        conversation_id: text(input.conversation_id), turn_id: text(input.turn_id),
        session_id: crypto.randomUUID()
    };
    if (!actor.provider || !actor.name || !actor.conversation_source || !actor.conversation_id) {
        throw new Error('AI mode requires a provider, agent name, conversation source, and conversation ID.');
    }
    return actor;
}

export function resolveActor(history = [], at = Date.now(), signals = {}) {
    const entry = [...history].reverse().find(item => item.at <= at);
    let actor = entry && (!entry.expires_at || at < entry.expires_at) ? { ...entry.actor } : { ...DEFAULT_HUMAN_ACTOR };
    if (actor.kind === 'unknown') actor = { ...DEFAULT_HUMAN_ACTOR, ...(actor.signals ? { signals: actor.signals } : {}) };
    const hints = {};
    for (const key of ['webdriver', 'synthetic_event', 'agent_tab_group']) if (actor.signals?.[key] === true) hints[key] = true;
    if (signals.webdriver === true) hints.webdriver = true;
    if (signals.is_trusted === false) hints.synthetic_event = true;
    if (signals.synthetic_event === true) hints.synthetic_event = true;
    if (signals.agent_tab_group === true) hints.agent_tab_group = true;
    // Positive automation evidence overrides the human default and manual Me mode.
    if (Object.keys(hints).length) {
        actor.signals = { ...(actor.signals || {}), ...hints };
        if (actor.kind !== 'agent') actor = { ...UNKNOWN_ACTOR, kind: 'automation', method: hints.webdriver ? 'webdriver' : hints.agent_tab_group ? 'tab_group_hint' : 'synthetic_event', signals: actor.signals };
    }
    return actor;
}

export class ActorStore {
    constructor(storage, prefix = "browserActor") { this.storage = storage; this.key = id => `${prefix}:${id}`; this.tail = Promise.resolve(); }
    serial(fn) { const result = this.tail.then(fn); this.tail = result.catch(() => {}); return result; }
    history(tabId) { return this.serial(async () => (await this.storage.get(this.key(tabId)))[this.key(tabId)] || []); }
    async snapshot(tabId, signals = {}, at = Date.now()) { return resolveActor(await this.history(tabId), at, signals); }
    set(tabId, actor, { at = Date.now(), expires_at = null, controller = null } = {}) {
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('A valid tab is required.');
        return this.serial(async () => {
            const key = this.key(tabId);
            const history = (await this.storage.get(key))[key] || [];
            const entry = { actor: { ...actor, assigned_at: new Date(at).toISOString() }, at, expires_at, controller };
            await this.storage.set({ [key]: [...history, entry].slice(-128) });
            return entry.actor;
        });
    }
    end(tabId, sessionId, controller) {
        return this.serial(async () => {
            const key = this.key(tabId);
            const history = (await this.storage.get(key))[key] || [];
            const current = history.at(-1);
            if (current?.actor.session_id !== sessionId || current?.controller !== controller) throw new Error('This controller no longer owns the tab session.');
            await this.storage.set({ [key]: [...history, { actor: { ...DEFAULT_HUMAN_ACTOR }, at: Date.now() }].slice(-128) });
        });
    }
    remove(tabId) { return this.serial(() => this.storage.remove(this.key(tabId))); }
    replaceTab(addedTabId, removedTabId) {
        return this.serial(async () => {
            const oldKey = this.key(removedTabId), newKey = this.key(addedTabId);
            const stored = await this.storage.get([oldKey, newKey]);
            // Preserve the event-time history and lease, without overwriting an
            // explicit handoff that already belongs to the replacement tab.
            if (stored[oldKey]?.length && !stored[newKey]?.length) {
                await this.storage.set({ [newKey]: stored[oldKey] });
            }
            await this.storage.remove(oldKey);
        });
    }
}

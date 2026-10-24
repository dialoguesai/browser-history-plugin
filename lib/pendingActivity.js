// A short, bounded follow-up window. Entries survive MV3 worker suspension.
// Timers deliver promptly; an alarm / the next event recovers interrupted timers.
export class PendingActivity {
    constructor(storage, send, { holdMs = 2500, now = Date.now } = {}) {
        this.storage = storage; this.send = send; this.holdMs = holdMs; this.now = now;
        this.tail = Promise.resolve();
    }
    serial(fn) { const result = this.tail.then(fn); this.tail = result.catch(() => {}); return result; }
    add(item) {
        return this.serial(async () => {
            const id = item.record.capture_id;
            const entry = { ...item, deadline: this.now() + this.holdMs };
            await this.storage.set({ [`pendingActivity:${id}`]: entry });
        });
    }
    resolve(tabId, actor, documentId = null) {
        return this.serial(async () => {
            const items = await this.storage.get(null);
            for (const [key, item] of Object.entries(items)) {
                if (!key.startsWith('pendingActivity:') || item.record.tab_id !== tabId || item.deadline < this.now()) continue;
                if (documentId && item.documentId && documentId !== item.documentId) continue;
                if (item.record.actor.kind !== 'unknown' && !(item.record.actor.kind === 'automation' && actor.kind === 'agent')) continue;
                if (actor.kind === 'unknown') continue;
                // Only this still-pending action is linked; never relabel sent history.
                item.record.actor = { ...actor, method: 'followup', identity_method: actor.method, observed_at: item.record.visited_at };
                await this.storage.set({ [key]: item });
            }
        });
    }
    flush() {
        return this.serial(async () => {
            const items = await this.storage.get(null);
            for (const [key, item] of Object.entries(items)) {
                if (!key.startsWith('pendingActivity:') || item.deadline > this.now()) continue;
                // Stable capture_id makes a retried TOPOS write idempotent.
                const result = await this.send(item);
                item.delivered = { ...(item.delivered || {}), ...(result?.topos?.sent ? { topos: true } : {}), ...(result?.supabase?.sent ? { supabase: true } : {}) };
                await this.storage.set({ [key]: item });
                const retry = result?.topos && !result.topos.sent && !['not_attached', 'auth_expired'].includes(result.topos.reason);
                if (!retry) await this.storage.remove(key);
            }
        });
    }
}

// Manifest V3 disallows remote executable imports. Use Supabase's REST API.
export function resetSupabaseClient() {}

/** True for rejections that will repeat on every insert (RLS policy, bad/expired key) — retrying is pure error spam. */
function isAuthOrPolicyError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return (
        code === '42501' ||
        code === 'PGRST301' ||
        /row-level security/i.test(message) ||
        /invalid api key/i.test(message) ||
        /jwt/i.test(message)
    );
}

export async function insertSupabase(table, record) {
    const { supabaseSinkDisabledReason } = await chrome.storage.sync.get({ supabaseSinkDisabledReason: '' });
    if (supabaseSinkDisabledReason) return { sent: false, reason: 'disabled', detail: supabaseSinkDisabledReason };
    const { supabaseUrl, anonKey, supabaseActorColumns = false } = await chrome.storage.sync.get({ supabaseUrl: '', anonKey: '', supabaseActorColumns: false });
    if (!supabaseUrl || !anonKey) return { sent: false, reason: 'not_configured' };
    const body = { ...record };
    // Existing installations have the legacy SQL schema. Opt in after applying
    // tables/add_browser_actor.sql; TOPOS always receives the full record.
    if (!supabaseActorColumns) { delete body.actor; delete body.capture_id; }
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(table)}${supabaseActorColumns ? '?on_conflict=capture_id' : ''}`, {
        method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', Prefer: supabaseActorColumns ? 'return=minimal,resolution=ignore-duplicates' : 'return=minimal' }, body: JSON.stringify(body)
    });
    const error = response.ok ? null : await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    if (error) {
        if (isAuthOrPolicyError(error)) {
            const detail = `Supabase rejected writes to "${table}" (${error.code || 'auth'}: ${error.message}). Sink disabled until settings are saved again. If this is a shared project, its RLS policy intentionally blocks anon inserts — use the Topos attach instead, or point at your own Supabase project with an insert policy.`;
            await chrome.storage.sync.set({ supabaseSinkDisabledReason: detail });
            console.warn('[SUPABASE] Disabling sink:', detail);
            return { sent: false, reason: 'disabled', detail, error };
        }
        return { sent: false, reason: 'insert_error', error };
    }
    return { sent: true };
}

export async function listStarredWebsites() {
    const { supabaseUrl, anonKey } = await chrome.storage.sync.get({ supabaseUrl: '', anonKey: '' });
    if (!supabaseUrl || !anonKey) return { configured: false };
    try {
        const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/starred_websites?select=*&order=starred_at.desc&limit=50`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
        });
        return response.ok ? { configured: true, data: await response.json() } : { configured: true, error: true };
    } catch { return { configured: true, error: true }; }
}

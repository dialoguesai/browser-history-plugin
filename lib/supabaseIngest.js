import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

let cachedClient = null;
let cachedKey = '';

export async function getSupabaseClient() {
    const { supabaseUrl, anonKey } = await chrome.storage.sync.get({ supabaseUrl: '', anonKey: '' });
    if (!supabaseUrl || !anonKey) return null;
    const key = `${supabaseUrl}|${anonKey}`;
    if (!cachedClient || cachedKey !== key) {
        cachedClient = createClient(supabaseUrl, anonKey);
        cachedKey = key;
    }
    return cachedClient;
}

export function resetSupabaseClient() {
    cachedClient = null;
    cachedKey = '';
}

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
    const client = await getSupabaseClient();
    if (!client) return { sent: false, reason: 'not_configured' };
    const { error } = await client.from(table).insert(record);
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

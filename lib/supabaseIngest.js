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

export async function insertSupabase(table, record) {
    const client = await getSupabaseClient();
    if (!client) return { sent: false, reason: 'not_configured' };
    const { error } = await client.from(table).insert(record);
    if (error) return { sent: false, reason: 'insert_error', error };
    return { sent: true };
}

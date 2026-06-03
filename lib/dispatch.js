import { sendToTopos } from './toposIngest.js';
import { insertSupabase } from './supabaseIngest.js';

/**
 * Fan out one record to Topos (app_ingest) and/or Supabase when each sink is configured.
 * Failures on one sink do not block the other.
 */
export async function dispatchRecord({ sourceId, record, supabaseTable = 'browserplugin' }) {
    const results = { topos: null, supabase: null };
    const [toposResult, supabaseResult] = await Promise.allSettled([
        sendToTopos(sourceId, [record]),
        insertSupabase(supabaseTable, record)
    ]);
    results.topos = toposResult.status === 'fulfilled' ? toposResult.value : { sent: false, reason: 'exception', error: toposResult.reason };
    results.supabase =
        supabaseResult.status === 'fulfilled' ? supabaseResult.value : { sent: false, reason: 'exception', error: supabaseResult.reason };
    return results;
}

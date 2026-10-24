import { sendToTopos } from './toposIngest.js';
import { insertSupabase } from './supabaseIngest.js';

/**
 * Fan out one record to Topos (app_ingest) and/or Supabase when each sink is configured.
 * Failures on one sink do not block the other.
 */
export async function dispatchRecord({ sourceId, record, supabaseTable = 'browserplugin', delivered = {} }) {
    const results = { topos: null, supabase: null };
    const [toposResult, supabaseResult] = await Promise.allSettled([
        delivered.topos ? Promise.resolve({ sent: true }) : sendToTopos(sourceId, [record]),
        delivered.supabase ? Promise.resolve({ sent: true }) : insertSupabase(supabaseTable, record)
    ]);
    results.topos = toposResult.status === 'fulfilled' ? toposResult.value : { sent: false, reason: 'exception', error: toposResult.reason };
    results.supabase =
        supabaseResult.status === 'fulfilled' ? supabaseResult.value : { sent: false, reason: 'exception', error: supabaseResult.reason };
    return results;
}

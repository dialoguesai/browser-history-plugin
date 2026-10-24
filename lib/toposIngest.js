import { installationStorage } from './installationStorage.js';
import { getControlPlaneUrl } from './config.js';

function isEngineResponseTimeout(status, bodyText) {
    if (status !== 504) return false;
    const text = String(bodyText || '').toLowerCase();
    return text.includes('engine response timeout');
}

export async function sendToTopos(sourceId, records) {
    const { dialoguesToken, dialoguesResourceId, dialoguesControlPlaneUrl } = await installationStorage.get({
        dialoguesToken: '',
        dialoguesResourceId: '',
        dialoguesControlPlaneUrl: ''
    });
    const controlPlaneUrl = (dialoguesControlPlaneUrl || getControlPlaneUrl()).replace(/\/$/, '');
    if (!dialoguesToken || !dialoguesResourceId || !controlPlaneUrl) {
        return { sent: false, reason: 'not_attached' };
    }
    const appIngestUrl = `${controlPlaneUrl}/v1/ingestion/app_ingest`;
    try {
        const response = await fetch(appIngestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${dialoguesToken}`
            },
            body: JSON.stringify({
                resource_id: dialoguesResourceId,
                source_id: sourceId,
                records
            })
        });
        if (response.status === 401 || response.status === 403) {
            const errorBody = await response.text();
            await installationStorage.remove(['dialoguesToken', 'dialoguesResourceId']);
            return { sent: false, reason: 'auth_expired', status: response.status, body: errorBody };
        }
        if (response.status === 202) {
            let body = {};
            try {
                body = await response.json();
            } catch (_err) {
                body = {};
            }
            return {
                sent: true,
                queued: true,
                write_id: body.write_id || null,
                status: response.status,
            };
        }
        if (response.status === 502 || response.status === 503 || !response.ok) {
            const errorText = await response.text();
            // CP timed out waiting for engine ack, but the write often still lands on the node.
            if (isEngineResponseTimeout(response.status, errorText)) {
                return {
                    sent: true,
                    in_flight: true,
                    status: response.status,
                    body: errorText
                };
            }
            return { sent: false, reason: 'engine_or_server_error', status: response.status, body: errorText };
        }
        return { sent: true, status: response.status };
    } catch (err) {
        return { sent: false, reason: 'network_error', error: err };
    }
}

export async function sendToTopos(sourceId, records) {
    const { dialoguesToken, dialoguesResourceId, dialoguesControlPlaneUrl } = await chrome.storage.sync.get({
        dialoguesToken: '',
        dialoguesResourceId: '',
        dialoguesControlPlaneUrl: ''
    });
    if (!dialoguesToken || !dialoguesResourceId || !dialoguesControlPlaneUrl) {
        return { sent: false, reason: 'not_attached' };
    }
    const controlPlaneUrl = dialoguesControlPlaneUrl.replace(/\/$/, '');
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
            await chrome.storage.sync.remove(['dialoguesToken', 'dialoguesResourceId']);
            return { sent: false, reason: 'auth_expired', status: response.status, body: errorBody };
        }
        if (response.status === 502 || response.status === 503 || !response.ok) {
            const errorText = await response.text();
            return { sent: false, reason: 'engine_or_server_error', status: response.status, body: errorText };
        }
        return { sent: true };
    } catch (err) {
        return { sent: false, reason: 'network_error', error: err };
    }
}

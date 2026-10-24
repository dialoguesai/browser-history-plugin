// Manifest content scripts are classic scripts, not ES modules.
if (location.hostname === '127.0.0.1' && location.pathname.startsWith('/.well-known/topos-agent/v1/')) {
    // No tracking of local capability URLs or their fragments.
    chrome.runtime.sendMessage({ type: 'AGENT_BRIDGE_READY' });
} else {
    void import(chrome.runtime.getURL('content.js'));
}

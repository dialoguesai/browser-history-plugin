console.log('[CONTENT] Content script injected and running');
// Capture any HTML5 <video> play event and notify background
document.addEventListener('play', event => {
    const video = event.target;
    if (video.tagName === 'VIDEO' && video.currentSrc) {
        chrome.runtime.sendMessage({
            type: 'VIDEO_PLAY',
            videoUrl: video.currentSrc,
            pageUrl: location.href,
            pageTitle: document.title,
            timestamp: new Date().toISOString()
        });
    }
}, true);
// Inject a floating star button for starring the current page
(function () {
    if (window.__starButtonInjected) return;
    window.__starButtonInjected = true;

    const btn = document.createElement('button');
    btn.innerText = '⭐ Star';
    btn.id = '__star_website_button';
    btn.style.position = 'fixed';
    btn.style.bottom = '24px';
    btn.style.right = '24px';
    btn.style.zIndex = 99999;
    btn.style.padding = '10px 18px';
    btn.style.background = '#fffbe6';
    btn.style.border = '1px solid #ffd700';
    btn.style.borderRadius = '24px';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
    btn.style.fontSize = '18px';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', () => {
        console.log("Sending runtime message")
        chrome.runtime.sendMessage({
            type: 'STAR_PAGE',
            url: location.href,
            title: document.title,
            favicon_url: (document.querySelector("link[rel~='icon']") || {}).href || '',
            device_name: '', // Optionally fill from storage if needed
            tab_id: null,
            window_id: null,
            incognito: null,
            transition_type: null,
            hostname: location.hostname,
            pinned: null,
            audible: null,
            muted: null,
            opener_tab_id: null
        });
        console.log("Sent message...")
        btn.innerText = '⭐ Starred!';
        btn.disabled = true;
        setTimeout(() => {
            btn.innerText = '⭐ Star';
            btn.disabled = false;
        }, 2000);
    });

    document.body.appendChild(btn);
})();
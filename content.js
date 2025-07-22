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
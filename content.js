import { shouldSkipInteraction } from './lib/skipDomains.js';

/**
 * Read user prefs from storage
 */
function getPrefs() {
    return new Promise(resolve => {
        try {
            if (!chrome.runtime?.id) {
                resolve({
                    device_name: '',
                    user_id: null,
                    referred_by: document.referrer || null
                });
                return;
            }
            chrome.storage.sync.get(
                {
                    device_name: '',
                    user_id: null,
                    referred_by: document.referrer || null
                },
                prefs => resolve(prefs)
            );
        } catch (err) {
            resolve({
                device_name: '',
                user_id: null,
                referred_by: document.referrer || null
            });
        }
    });
}

function getPageMeta() {
    return {
        url: location.href,
        visited_at: new Date().toISOString(),
        title: document.title,
        favicon_url: (document.querySelector("link[rel~='icon']") || {}).href || null,
        hostname: location.hostname
    };
}

async function sendRichMessage(eventType, transitionType, contentObj = {}, extras = {}) {
    try {
        if (!chrome.runtime?.id) return;
        const prefs = await getPrefs();
        const meta = getPageMeta();

        chrome.runtime.sendMessage({
            event_type: eventType,
            type: eventType,
            transition_type: transitionType,
            ...meta,
            ...prefs,
            ...extras,
            content: contentObj
        });
    } catch (err) {
        console.warn('[CONTENT] Error sending message (extension may have reloaded):', err);
    }
}

function initVideoPlayTracking() {
    document.addEventListener('play', e => {
        const v = e.target;
        if (v.tagName === 'VIDEO' && v.currentSrc) {
            sendRichMessage('VIDEO_PLAY', 'video_play', { videoUrl: v.currentSrc });
        }
    }, true);
}

async function maybeInjectStarButton() {
    if (window.__starButtonInjected) return;
    try {
        if (!chrome.runtime?.id) return;
        const { showStarButton = false } = await chrome.storage.sync.get({ showStarButton: false });
        if (!showStarButton) return;
        window.__starButtonInjected = true;
    } catch {
        return;
    }

    const btn = document.createElement('button');
    btn.setAttribute('data-star-button', '1');
    btn.innerText = '⭐ Star';
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 99999,
        padding: '10px 18px',
        background: '#fffbe6',
        border: '1px solid #ffd700',
        borderRadius: '24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        fontSize: '18px',
        cursor: 'pointer'
    });

    btn.addEventListener('click', () => {
        sendRichMessage('STAR_PAGE', 'star_page');
        btn.innerText = '⭐ Starred!';
        btn.disabled = true;
        setTimeout(() => {
            btn.innerText = '⭐ Star';
            btn.disabled = false;
        }, 2000);
    });

    document.body.appendChild(btn);
}

function initStarButtonWatcher() {
    maybeInjectStarButton();
    try {
        if (!chrome.runtime?.id) return;
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, 'showStarButton')) {
                if (changes.showStarButton.newValue === false) {
                    const btn = document.querySelector('button[data-star-button]');
                    if (btn) btn.remove();
                    window.__starButtonInjected = false;
                } else {
                    maybeInjectStarButton();
                }
            }
        });
    } catch (err) {
        console.warn('[CONTENT] Error setting up storage listener:', err);
    }
}

function initClickTracking() {
    const DEBOUNCE = 500;
    const LIMIT = 100;
    let lastTime = 0;
    let count = 0;

    function selector(el) {
        if (!el) return '';
        if (el.id) return `#${el.id}`;
        if (typeof el.className === 'string' && el.className.trim()) {
            return `${el.tagName.toLowerCase()}.${el.className.trim().replace(/\s+/g, '.')}`;
        }
        return el.tagName.toLowerCase();
    }

    async function onClick(e) {
        const now = Date.now();
        if (now - lastTime < DEBOUNCE) return;
        if (count >= LIMIT) return;
        lastTime = now;
        count++;

        await sendRichMessage('click', 'click', {
            x: e.clientX,
            y: e.clientY,
            element: selector(e.target),
            timestamp: new Date().toISOString()
        });
    }

    document.addEventListener('click', onClick, true);
}

function initHighlightTracking() {
    function anchorTag(sel) {
        const node = sel.anchorNode;
        const el = node?.nodeType === 1 ? node : node?.parentElement;
        return el?.tagName.toLowerCase() || '';
    }

    async function onSelect() {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const txt = sel.toString().trim();
        if (!txt) return;

        await sendRichMessage('highlight', 'highlight', {
            selectedText: txt,
            anchorNode: anchorTag(sel),
            timestamp: new Date().toISOString()
        });
    }

    document.addEventListener('mouseup', onSelect, false);
    document.addEventListener('keyup', e => {
        if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            onSelect();
        }
    }, false);
}

function initInteractionTracking() {
    initVideoPlayTracking();
    initClickTracking();
    initHighlightTracking();
}

const skipInteraction = shouldSkipInteraction(location.hostname);
if (skipInteraction) {
    console.log('[CONTENT] Visit logging only on conferencing host:', location.hostname);
} else {
    initInteractionTracking();
}

initStarButtonWatcher();

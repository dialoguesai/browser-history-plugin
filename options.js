// options.js

// grabs elements
const urlInput = document.getElementById('supabaseUrl');
const keyInput = document.getElementById('anonKey');
const listInput = document.getElementById('skipList');
const deviceNameInput = document.getElementById('deviceName');
const showStarButtonInput = document.getElementById('showStarButton');
const saveButton = document.getElementById('save');
const statusText = document.getElementById('status');

// load saved settings on open
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get({
        supabaseUrl: '',
        anonKey: '',
        skipDomains: [],
        device_name: '',
        showStarButton: true
    }, (items) => {
        urlInput.value = items.supabaseUrl;
        keyInput.value = items.anonKey;
        listInput.value = items.skipDomains.join('\n');
        deviceNameInput.value = items.device_name || '';
        showStarButtonInput.checked = items.showStarButton !== false;
    });
});

// save settings when button clicked
saveButton.addEventListener('click', () => {
    const supabaseUrl = urlInput.value.trim();
    const anonKey = keyInput.value.trim();
    const skipDomains = listInput.value
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length);
    const device_name = deviceNameInput.value.trim();
    const showStarButton = !!showStarButtonInput.checked;

    chrome.storage.sync.set({ supabaseUrl, anonKey, skipDomains, device_name, showStarButton }, () => {
        statusText.style.visibility = 'visible';
        setTimeout(() => statusText.style.visibility = 'hidden', 1500);
    });
    // Display starred websites in the options page
    document.addEventListener('DOMContentLoaded', () => {
        chrome.storage.sync.get({
            supabaseUrl: '',
            anonKey: ''
        }, async (items) => {
            if (!items.supabaseUrl || !items.anonKey) return;

            // Dynamically import Supabase client
            const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
            const supabase = createClient(items.supabaseUrl, items.anonKey);

            // Fetch starred websites
            const { data, error } = await supabase
                .from('starred_websites')
                .select('*')
                .order('starred_at', { ascending: false })
                .limit(50);

            const container = document.getElementById('starredWebsites');
            if (error) {
                container.innerText = 'Error loading starred websites.';
                return;
            }
            if (!data || data.length === 0) {
                container.innerText = 'No starred websites yet.';
                return;
            }

            // Render as a list
            const list = document.createElement('ul');
            list.style.paddingLeft = '1.2em';
            data.forEach(item => {
                const li = document.createElement('li');
                li.style.marginBottom = '0.5em';
                li.innerHTML = `
                    <a href="${item.url}" target="_blank" style="font-weight:bold">${item.title || item.url}</a>
                    <span style="color:#888; font-size:0.9em;">(${new Date(item.starred_at).toLocaleString()})</span>
                `;
                list.appendChild(li);
            });
            container.innerHTML = '';
            container.appendChild(list);
        });
    });
});
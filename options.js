// options.js

// grabs elements
const urlInput = document.getElementById('supabaseUrl');
const keyInput = document.getElementById('anonKey');
const listInput = document.getElementById('skipList');
const deviceNameInput = document.getElementById('deviceName');
const saveButton = document.getElementById('save');
const statusText = document.getElementById('status');

// load saved settings on open
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get({
        supabaseUrl: '',
        anonKey: '',
        skipDomains: [],
        device_name: ''
    }, (items) => {
        urlInput.value = items.supabaseUrl;
        keyInput.value = items.anonKey;
        listInput.value = items.skipDomains.join('\n');
        deviceNameInput.value = items.device_name || '';
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

    chrome.storage.sync.set({ supabaseUrl, anonKey, skipDomains, device_name }, () => {
        statusText.style.visibility = 'visible';
        setTimeout(() => statusText.style.visibility = 'hidden', 1500);
    });
});
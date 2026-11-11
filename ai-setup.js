import { setupRequest } from './lib/agentSetup.js';
const tool = document.getElementById('tool');
const prompt = document.getElementById('setup-prompt');
const status = document.getElementById('copy-status');
function update() {
    prompt.value = setupRequest(tool.value);
    document.getElementById('install-command').textContent = `node agent-bridge/install.mjs --tool ${tool.value} --dry-run`;
    status.textContent = '';
}
tool.addEventListener('change', update);
document.getElementById('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(prompt.value); status.textContent = 'Copied. Paste this into your work tool.'; }
    catch { prompt.focus(); prompt.select(); status.textContent = 'Copy the selected request, then paste it into your work tool.'; }
});
update();

import { isDefaultHuman } from './lib/actor.js';
const $ = id => document.getElementById(id);
const explicitTab = new URL(location.href).searchParams.get('tab');
const tab = explicitTab !== null ? await chrome.tabs.get(Number(explicitTab)) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const fields = ['provider', 'name', 'conversation_source', 'conversation_id', 'turn_id'];
const request = async message => {
    const result = await chrome.runtime.sendMessage({ ...message, tab_id: tab?.id });
    if (!result?.ok) throw new Error(result?.error || 'Could not update attribution.');
    return result;
};
function showFields() { $('identity').hidden = $('kind').value !== 'agent'; for (const field of fields.slice(0, 4)) $(field).required = !$('identity').hidden; }
document.querySelectorAll('[name=controller]').forEach(choice => choice.addEventListener('change', () => { $('kind').value = choice.value; showFields(); }));
$('tab-title').textContent = tab?.title || 'No active tab';
try {
    const { actor, controllers, groupNames } = await request({ type: 'ACTOR_STATUS' });
    $('kind').value = ['human', 'agent'].includes(actor.kind) && !isDefaultHuman(actor) ? actor.kind : 'unknown';
    document.querySelectorAll('[name=controller]').forEach(choice => { choice.checked = choice.value === $('kind').value; });
    fields.forEach(field => { $(field).value = actor[field] || ''; });
    $('controllers').value = controllers.join('\n');
    $('group-names').value = groupNames.join('\n');
    $('status').textContent = actor.kind === 'agent' ? `${actor.name} · ${actor.provider}` : actor.kind === 'automation' ? 'Automation detected. Identify the agent to link its conversation.' : isDefaultHuman(actor) || actor.kind === 'unknown' ? 'This tab defaults to your activity.' : 'This tab is marked as your activity.';
    showFields();
} catch (error) { $('status').textContent = error.message; }
$('actor-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        const actor = { kind: $('kind').value, ...Object.fromEntries(fields.map(field => [field, $(field).value])) };
        await request({ type: 'ACTOR_SET', actor });
        $('status').textContent = actor.kind === 'agent' ? `Attributing this tab to ${actor.name}.` : actor.kind === 'human' ? 'You are now the controller.' : 'Automatic mode enabled. This tab defaults to your activity.';
    } catch (error) { $('status').textContent = error.message; }
});
$('save-controllers').addEventListener('click', async () => {
    try {
        await request({ type: 'ACTOR_CONTROLLERS', controllers: $('controllers').value.split(/\s+/).filter(Boolean), groupNames: $('group-names').value.split('\n').map(s => s.trim()).filter(Boolean) });
        $('status').textContent = 'Approved controllers saved.';
    } catch (error) { $('status').textContent = error.message; }
});
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

export function setupRequest(tool) {
    if (!['codex', 'claude'].includes(tool)) throw new Error('Unsupported tool');
    return `Set up TOPOS browser attribution for ${tool === 'codex' ? 'Codex' : 'Claude Code'} on this computer. Use the official open-source repository https://github.com/dialoguesai/browser-history-plugin (or my existing checkout). Read docs/ai-tool-setup.md and inspect agent-bridge/install.mjs. Run node agent-bridge/install.mjs --tool ${tool} --dry-run, then install with the same command without --dry-run, preserving my existing instructions. This is my request to enable the workflow; follow your normal execution approvals. Report any existing skill conflict instead of overwriting it. Tell me which files changed and how to verify attribution in a new chat. Do not claim setup proves that browser events have been attributed.`;
}

export async function openFirstRun(details, runtime) {
    if (details?.reason === 'install') await runtime.openOptionsPage();
}

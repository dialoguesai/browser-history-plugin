#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const START = '<!-- TOPOS browser attribution: begin -->';
const END = '<!-- TOPOS browser attribution: end -->';
const MARKER = 'topos-browser-attribution-v1\n';
const TOOLS = {
    codex: { name: 'Codex', provider: 'OpenAI', source: 'codex_sessions', identity: '`CODEX_THREAD_ID` / `CODEX_SESSION_ID`', dir: '.codex', env: 'CODEX_HOME', guide: 'AGENTS.md' },
    claude: { name: 'Claude', provider: 'Anthropic', source: 'claude_code_sessions', identity: '`CLAUDECODE=1` and `CLAUDE_CODE_SESSION_ID`', dir: '.claude', env: 'CLAUDE_CONFIG_DIR', guide: 'CLAUDE.md' }
};
async function exists(path) {
    try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function read(path) { return await exists(path) ? readFile(path, 'utf8') : ''; }

export async function install({ tool, dryRun = false, home = homedir(), env = process.env } = {}) {
    const spec = TOOLS[tool];
    if (!spec) throw new Error('Choose --tool codex or --tool claude.');
    const root = resolve(env[spec.env] || join(home, spec.dir));
    const skill = join(root, 'skills', 'topos-browser-attribution');
    const override = join(root, 'AGENTS.override.md');
    const guide = tool === 'codex' && (await read(override)).trim() ? override : join(root, spec.guide);
    const files = ['SKILL.md', 'scripts/cli.mjs', 'scripts/server.mjs', '.topos-managed'];
    // Refuse symlinks along write paths; do not follow a user skill into a different installation.
    for (const target of [guide, ...files.map(file => join(skill, file))]) {
        for (let path = target; ; path = dirname(path)) {
            if ((await exists(path))?.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${path}`);
            if (dirname(path) === path) break;
        }
    }
    if (await exists(skill) && await read(join(skill, '.topos-managed')) !== MARKER) {
        throw new Error(`An unmanaged skill already exists at ${skill}. Back it up and move it aside before installing.`);
    }
    const existing = await read(guide);
    const starts = existing.split(START).length - 1, ends = existing.split(END).length - 1;
    if (starts !== ends || starts > 1 || (starts && existing.indexOf(END) < existing.indexOf(START))) throw new Error('Malformed TOPOS instruction block; leave it intact and repair it before retrying.');
    const block = `${START}\nBefore controlling a tab in a user browser with TOPOS installed, read and follow the skill at ${JSON.stringify(join(skill, 'SKILL.md'))}. Verify the current-chat handoff before browsing and release it before returning control or ending the turn. This includes native computer use; search tools, connector API calls, and browsers without TOPOS are outside this rule. If attribution fails, report the blocker instead of silently recording AI work as human.\n${END}`;
    const guidance = starts ? existing.slice(0, existing.indexOf(START)) + block + existing.slice(existing.indexOf(END) + END.length) : existing + (existing.endsWith('\n') || !existing ? '\n' : '\n\n') + block + '\n';
    const values = { NAME: spec.name, PROVIDER: spec.provider, SOURCE: spec.source, IDENTITY: spec.identity, TOOL: tool };
    const template = (await readFile(join(HERE, 'SKILL.template.md'), 'utf8')).replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]);
    const contents = [template, await readFile(join(HERE, 'cli.mjs'), 'utf8'), await readFile(join(HERE, 'server.mjs'), 'utf8'), MARKER];
    const writes = [...files.map((file, i) => ({ path: join(skill, file), content: contents[i] })), { path: guide, content: guidance }];
    const changed = [];
    for (const entry of writes) if (await read(entry.path) !== entry.content) changed.push(entry);
    if (!dryRun) {
        for (const { path, content } of changed) {
            await mkdir(dirname(path), { recursive: true });
            if (await exists(path)) await copyFile(path, `${path}.topos-backup-${Date.now()}`);
            await writeFile(path, content, { mode: 0o600 });
        }
    }
    return { tool, dry_run: dryRun, skill, guidance: guide, changed: changed.map(entry => entry.path), next: 'Start a new chat in your work tool, then verify a browser handoff. Installation alone does not prove runtime attribution.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2);
        if (args.includes('--help')) {
            console.log('node agent-bridge/install.mjs --tool codex|claude [--dry-run]\nInstalls a local skill and a managed global instruction block. No dependencies, network calls, or browser permission changes. Node 20+ required.');
        } else {
            const options = {};
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '--dry-run') options.dryRun = true;
                else if (args[i] === '--tool' && args[i + 1]) options.tool = args[++i];
                else throw new Error('Usage: node agent-bridge/install.mjs --tool codex|claude [--dry-run]');
            }
            if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node 20 or newer is required.');
            console.log(JSON.stringify(await install(options), null, 2));
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

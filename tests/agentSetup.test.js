import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../agent-bridge/install.mjs';
import { setupRequest, openFirstRun } from '../lib/agentSetup.js';

async function fixture(t) {
    const home = await mkdtemp(join(await realpath(tmpdir()), 'topos-agent-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    return home;
}

test('dry-run makes no files; installation preserves guidance and works without the checkout', async t => {
    const home = await fixture(t);
    await mkdir(join(home, '.codex'));
    const guide = join(home, '.codex', 'AGENTS.md');
    await writeFile(guide, '# My preferences\nKeep this verbatim.\n');
    const plan = await install({ tool: 'codex', home, env: {}, dryRun: true });
    assert.equal(plan.changed.length, 5);
    assert.deepEqual(await readdir(join(home, '.codex')), ['AGENTS.md']);
    assert.equal(await readFile(guide, 'utf8'), '# My preferences\nKeep this verbatim.\n');
    const result = await install({ tool: 'codex', home, env: {} });
    assert.ok((await readFile(guide, 'utf8')).startsWith('# My preferences\nKeep this verbatim.\n'));
    assert.ok((await readdir(join(home, '.codex'))).some(name => name.startsWith('AGENTS.md.topos-backup-')));
    const { codexIdentity } = await import(join(result.skill, 'scripts/server.mjs'));
    assert.equal(codexIdentity({ CODEX_THREAD_ID: '12345678-1234-1234-1234-123456789abc' }).conversation_id, 'codex:12345678-1234-1234-1234-123456789abc');
    const skill = await readFile(join(result.skill, 'SKILL.md'), 'utf8');
    assert.ok(!skill.includes('{{'));
    assert.match(skill, /--agent codex/);
    assert.match(skill, /CODEX_THREAD_ID/);
    assert.deepEqual((await install({ tool: 'codex', home, env: {} })).changed, []);
});

test('custom config homes and Codex override guidance are respected; managed updates preserve surrounding text', async t => {
    const home = await fixture(t), root = join(home, 'custom config');
    await mkdir(root);
    await writeFile(join(root, 'AGENTS.md'), 'Shadowed guide\n');
    await writeFile(join(root, 'AGENTS.override.md'), 'Active guide\n');
    const opts = { tool: 'codex', home, env: { CODEX_HOME: root } };
    const result = await install(opts);
    assert.equal(result.guidance, join(root, 'AGENTS.override.md'));
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'Shadowed guide\n');
    await writeFile(result.guidance, (await readFile(result.guidance, 'utf8')) + '\nLater user preference.\n');
    await writeFile(join(result.skill, 'scripts/cli.mjs'), '// older managed version');
    await install(opts);
    assert.ok((await readFile(result.guidance, 'utf8')).endsWith('\nLater user preference.\n'));
    assert.ok((await readFile(join(result.skill, 'scripts/cli.mjs'), 'utf8')).includes('startBridge'));
    const claude = await install({ tool: 'claude', home, env: { CLAUDE_CONFIG_DIR: join(home, 'claude config') } });
    assert.equal(claude.guidance, join(home, 'claude config', 'CLAUDE.md'));
    const skill = await readFile(join(claude.skill, 'SKILL.md'), 'utf8');
    assert.match(skill, /--agent claude/);
    assert.match(skill, /CLAUDE_CODE_SESSION_ID/);
    assert.ok(!skill.includes('CODEX_THREAD_ID'));
});

test('unmanaged skill, malformed guide, and symlinks are left intact', async t => {
    const home = await fixture(t), skill = join(home, '.codex/skills/topos-browser-attribution');
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), 'Personal skill');
    await assert.rejects(install({ tool: 'codex', home, env: {} }), /unmanaged skill/);
    assert.equal(await readFile(join(skill, 'SKILL.md'), 'utf8'), 'Personal skill');
    await rm(skill, { recursive: true });
    const guide = join(home, '.codex/AGENTS.md');
    await writeFile(guide, 'Keep\n<!-- TOPOS browser attribution: begin -->');
    await assert.rejects(install({ tool: 'codex', home, env: {} }), /Malformed/);
    assert.equal(await readFile(guide, 'utf8'), 'Keep\n<!-- TOPOS browser attribution: begin -->');
    await rm(guide);
    const other = join(home, 'other.md');
    await writeFile(other, 'Untouched');
    await symlink(other, guide);
    await assert.rejects(install({ tool: 'codex', home, env: {} }), /symlink/);
    assert.equal(await readFile(other, 'utf8'), 'Untouched');
});

test('first install opens settings once; updates do not interrupt browsing', async () => {
    let opens = 0;
    const runtime = { openOptionsPage: async () => { opens++; } };
    await openFirstRun({ reason: 'install' }, runtime);
    await openFirstRun({ reason: 'update' }, runtime);
    await openFirstRun({ reason: 'chrome_update' }, runtime);
    await openFirstRun(undefined, runtime);
    assert.equal(opens, 1);
    for (const tool of ['codex', 'claude']) {
        assert.ok(setupRequest(tool).includes(`--tool ${tool} --dry-run`));
        assert.ok(!setupRequest(tool).includes('/Users/'));
    }
    assert.throws(() => setupRequest('unknown'), /Unsupported/);
});

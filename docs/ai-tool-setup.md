# Set up your AI work tool

History capture works after installation and **Attach Dialogues**. To link AI-controlled visits to the conversation that caused them, configure the local work tool once. Open **Connection settings → Set up your AI tool**, or use the commands below. The setup page is included in the extension, and connection settings open on first installation (not on updates).

## Install from the repository

Use the same downloaded repository as the extension, or clone `https://github.com/dialoguesai/browser-history-plugin`. Review `agent-bridge/install.mjs`, then run from the repository with Node 20+:

```sh
node agent-bridge/install.mjs --tool codex --dry-run
node agent-bridge/install.mjs --tool codex
```

For **Claude Code**, use `--tool claude`. This does not configure Claude's regular chat mode. Run the installer on the same computer as the browser. No npm dependencies, background daemon, account credentials, or browser permission changes are involved.

The installer copies the skill template and the repository's handoff helper into a durable tool directory. It appends a bounded instruction block, preserving the rest of the user's guidance. Re-running updates only managed files; unchanged installs are a no-op. Changed existing files get adjacent `.topos-backup-<timestamp>` copies. Existing skills not created by this installer are left intact: back them up and move them aside before installing. Do not delete unreviewed instructions.

| Tool | Default skill directory | Global instruction file |
| --- | --- | --- |
| Codex | `~/.codex/skills/topos-browser-attribution` | `~/.codex/AGENTS.md`, or an existing non-empty `AGENTS.override.md` |
| Claude Code | `~/.claude/skills/topos-browser-attribution` | `~/.claude/CLAUDE.md` |

`CODEX_HOME` and `CLAUDE_CONFIG_DIR` are respected. Paths come from the user's home/config directory, never a developer's checkout. The copied helper remains usable if the source checkout moves; repeat the installer after repository updates to refresh it. The browser extension remains a separate installation.

Start a **new chat** after installation so the work tool loads the instructions. See [Codex global instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [Claude Code memory](https://code.claude.com/docs/en/memory).

## Verify once

Ask the work tool to open a page with TOPOS attribution. It should run its helper, open the local handoff page, verify **Attributed to Codex/Claude**, then continue in that tab. The icon gains a cursor. Check the TOPOS timeline for the visit's name, provider, and parent conversation. On completion, the tool ends control and the cursor clears. A successful installer is not proof of this runtime behavior.

Codex's helper needs `CODEX_THREAD_ID` or `CODEX_SESSION_ID`. Claude Code needs `CLAUDECODE=1` and `CLAUDE_CODE_SESSION_ID` exposed to the helper. Availability depends on the host/runtime: if missing, attribution fails explicitly. Never paste an invented or old session ID. To open the linked chat from TOPOS, its conversation source must also be synced.

## Limits and troubleshooting

- The extension can recognize some agent groups/favicons without setup. That names detected automation, but cannot identify a parent chat.
- This is a cooperating-agent workflow, not interception of all computer use. A work tool can fail to follow instructions; conflicting project guidance or an old chat may prevent activation. Inspect loaded instructions and start a new chat before testing again.
- The helper binds to `127.0.0.1`. Remote/cloud work tools cannot use it to identify a browser on another computer. Sandbox denial requires the tool's normal execution approval, not disabled protections.
- A waiting handoff page is not success. Check that the browser profile has this extension, the helper is running, and website access allows the local handoff page. The AI should stop and explain a failure rather than record its actions as human.
- No Node 20+ or supported work tool? Ordinary capture still works. The toolbar's **AI agent** form offers manual attribution when you have the real identifiers; it is not automatic setup. Other tool authors can implement the [controller contract](browser-attribution.md).
- Ending the helper alone does not immediately release a tab. The work tool opens its `end_url`, verifies **Agent control ended**, then stops its helper. Leases expire as a fallback.

## Remove the integration

Finish active browser sessions first. Remove only the block between `<!-- TOPOS browser attribution: begin -->` and `<!-- TOPOS browser attribution: end -->` from the printed global instruction file, and remove the installed `topos-browser-attribution` skill directory. Keep all other instructions. Start a new chat. Removing this integration does not disconnect the browser extension or erase stored history.

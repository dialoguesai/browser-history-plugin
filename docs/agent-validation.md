# Agent-operation evidence

Development candidate, tested 2026-10-24. The earlier operator-assisted identity
form checks have now been superseded by a real automatic Codex handoff.

## Observed live

In Chrome 155 and Safari 27.0.1 on macOS, Codex ran the bundled helper in its
current chat, opened the local handoff page, and observed **Attributed to Codex**.
The helper obtained the actual current chat ID from its environment. Its exact
`codex_sessions` / `codex:<id>` reference matched the current chat metadata.
The owner entered no provider, name, source, conversation or session fields.
The private evidence files retain the actual ID; it is not published here.

Both browsers then navigated to a dedicated Example.com proof URL. The local
verifier received the normal extension capture records containing Codex,
OpenAI, the exact parent, session ID, and `controller_declared` method. Safari's
replacement tab retained that identity. Both sessions were ended through their
local end URLs without changing the popup fields.

After the owner granted Chrome's normal Attach Dialogues access, its live proof
visit returned `sent: true`, without queued/in-flight status. An authenticated
TOPOS query read back the same URL and event timestamp from the running 1.5.20
node. That released node does not preserve the new actor fields: it proves live
visit delivery, not deployed canonical actor preservation.

Safari's owner-grant flow failed at callback registration. The deployed server
accepts Chromium IDs/callbacks, while Safari supplies a UUID extension origin
and a different bundle ID. The candidate fixes registration and strict callback
validation on both sides. Live Safari delivery remains blocked until deployment.
Apple signing does not change this callback contract.

The cursor follow-up was verified in Safari: agent tab → unassigned tab → agent
tab → end session. The visual pointer followed the active tab, the question mark
was absent, and the recorded tab activation still carried the exact agent parent.

## Candidate-node acceptance, without updating the running node

The actual Chrome and Safari receipt files were replayed into an isolated node
database through the candidate app_ingest handler. Assertions verified raw and
canonical actor identity, exact parent conversation lookup, AI-only timeline
membership, zero human-filter matches, and zero eligible rows for personal
entities/topics/facts/goals/stats/sentiment jobs. This is an executable acceptance
test in node PR #195; the input files and resulting report remain private.

The owner installation/reload/website-access steps and Chrome's normal account
grant are setup prerequisites. They are separate from agent identity transfer.
The Chrome extension-manager URL policy was respected; the helper works through
an ordinary local website and the extension's implemented handoff protocol.

## Remaining acceptance

- Deploy the strict Safari callback fix, then complete its normal owner grant and
  read back a real Safari capture from TOPOS.
- Deploy the coordinated node/UI changes before relying on live canonical actor
  retention, parent navigation, AI filtering or personal-interest exclusion.
- Verify the signed Safari package, restart behavior and additional integrations.

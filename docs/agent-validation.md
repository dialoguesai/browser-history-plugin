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

The final queue-fix build was then reloaded in Chrome and tested again against
TOPOS 1.5.21. Its saved grant initially returned HTTP 403: the server reported
that the permission was no longer approved. Production logs confirmed Safari's
attachment had revoked one earlier browser-history grant as a duplicate. The
owner renewed Chrome's account grant; no agent identity fields were entered.
Two visits and one click then returned HTTP 200 (not queued or in flight), and
all three were read back by exact URL, source, timestamp and record ID. The
same real conversation parent was present in every outgoing record, and the
helper confirmed the session ended. Initial failures remain in the private
receipt; they are not counted as successful delivery.

The installation-aware server fix is now deployed in
[control plane #181](https://github.com/dialoguesai/control-plane/pull/181).
The original individual-browser results above remain historical evidence;
the simultaneous-browser check then passed: Chrome kept delivering after Safari's renewal. The latest plugin adds
local installation IDs, credentials and names, including a migration for existing
installs and protection against stale synced names in old content scripts.
All 24 plugin tests pass locally. No node release plan was changed.

Safari attachment now passes after deploying the strict callback fix in
[control-plane #178](https://github.com/dialoguesai/control-plane/pull/178).
Its normal owner grant completed and settings displayed **Connected to Topos**.
The same automatic handoff supplied Codex/OpenAI and the real conversation parent.
Thirteen actual captures carried that identity and received HTTP 202 queue
acceptance. Authenticated TOPOS 1.5.21 read-back subsequently matched one visit
and five interactions by exact URL, source, timestamp and record ID. The other
accepted records were not included in this read-back proof. Queue acceptance
alone is not treated as delivery. The installed node's canonical parser still
does not retain the actor envelope; no node update was performed for this test.

The live test exposed a deadlock when handoff waited on pending delivery while
delivery waited on the handoff queue. The bridge now acknowledges and leaves
its queue before resolving pending attribution. A regression reproduced the
failure before the fix; all 20 extension tests pass with the fix. The final live
Safari run used this corrected build.

The cursor follow-up was verified in Safari: agent tab → unassigned tab → agent
tab → end session. The visual pointer followed the active tab, the question mark
was absent, and the recorded tab activation still carried the exact agent parent.

The owner confirmed switching between the agent tab and their own separate tab
showed/cleared the pointer correctly. On the former AI tab, ending the session
cleared the pointer; explicitly selecting Me then displayed **You are now the
controller** and **TOPOS · You**. Codex operated this explicit mode check, so it
is not evidence of automatic human detection. The same-tab regression verifies
that queued AI actions retain their parent, subsequent human actions omit agent
identity, and stale agent capabilities cannot override the human selection.
Live human-action payload delivery was not verified by that UI check.

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

- Deploy the coordinated node/UI changes before relying on live canonical actor
  retention, parent navigation, AI filtering or personal-interest exclusion.
- Verify the signed Safari package, restart behavior and additional integrations.

## Claude in Chrome (Claude Desktop)

Claude in Chrome drives the owner's real Chrome profile. Without a handoff, its
tab looked human to the plugin: `navigator.webdriver` was false and a Claude click
arrived with `isTrusted: true`, so no automation hint fired and records stayed
`unknown`. With the local handoff and a Claude Code identity (provider Anthropic,
source `claude_code_sessions`, the real parent conversation), the extension
claimed the identity automatically and a visit and click delivered with HTTP 200
and the full actor envelope. The bundled CLI now includes this adapter (`--agent claude`).

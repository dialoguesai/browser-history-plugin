# Automatic local-agent handoff

The bundled Codex adapter works in Chrome and Safari after normal installation,
website permissions, and (for delivery) Attach Dialogues. The agent performs the
handoff. The owner never needs to fill in the agent identity fields.

## Agent procedure

Run from this repository in the current Codex chat environment (Node 20+):

```sh
node agent-bridge/cli.mjs --url https://example.com --lease-minutes 15
```

1. Keep the helper running. It reads `CODEX_THREAD_ID` / `CODEX_SESSION_ID`, rejects
   missing or conflicting IDs, and constructs the exact `codex_sessions` /
   `codex:<session-id>` parent. Do not invent an ID or reuse a different chat's ID.
2. Open the printed `launch_url` in the browser tab you will control.
3. Wait until the page visibly says **Attributed to Codex**. Verify the displayed
   parent. A waiting/error page is not a successful handoff; do not begin browsing.
4. Use **Continue** and browse in that same tab. The extension captures the actor
   on visits and supported events. A cursor appears on that tab's toolbar icon.
5. When finished, open the printed `end_url` in the same tab and verify
   **Agent control ended**. The cursor clears. A manual human handoff also wins
   over stale agent capabilities. Stop the helper after ending the session.

The helper binds only to `127.0.0.1` on a random port. There is no persistent
service, installed native host, browser-debugging permission or dependency to
install. It runs only during this handoff/session; the extension reuses its
existing alarm for expired-cursor cleanup (within 30 seconds, or on tab activation).
Use a fresh helper for each independently controlled tab. Child-tab inheritance
and approved-controller APIs are separate paths, not part of this live proof.

This is automatic identity transfer for a cooperating agent, not universal bot
detection. The integration must be invoked before browser work. Other providers
need an adapter that obtains their real source-scoped conversation identifiers;
there is no built-in Claude or other-provider environment adapter yet. Unknown
stays unknown when no declaration or positive signal exists.

## Verify before a node release

Opt in to a local receipt file for one non-sensitive test origin:

```sh
node agent-bridge/cli.mjs --url https://example.com \
  --verify-origin https://example.com --evidence /absolute/path/chrome.json
```

Use a separate `safari.json` for Safari. The receipt contains the extension's
actual captured records, actor, browser version, and delivery result from its
normal ingestion path. Only matching origin + tab session records are copied;
credentials and unrelated browsing are not included. The local file is private
(mode 0600) and may contain the real chat ID. Do not commit it or publish it.

An acknowledgement proves identity transfer. A receipt proves the extension
formed the attributed payload. `sent: true` proves the normal ingestion request
succeeded; a queued result does not. Read back the matching URL/time from TOPOS
separately to prove delivery. An old node may accept the visit but discard the
new actor envelope: plugin success does not certify downstream preservation.

TOPOS node's optional `tests/ingestion/test_browser_evidence_replay.py` accepts
`TOPOS_BROWSER_EVIDENCE_DIR` with these two files. It replays them through the
real app_ingest handler in an isolated database, tests exact parent lookup and
AI-only timeline results, and checks zero eligibility for personal enrichment.
This tests the candidate node without updating the owner's running node.

## Boundary

The claim capability is random, short-lived and bound to one extension-generated
client ID. The extension fetches identity directly from loopback; web pages do
not choose an actor. Requests check host/origin, require a custom header and
capability, and reject navigation races, expired leases and stale handoffs.
Reserved handoff pages are excluded from browsing capture so their capability
URLs never go to TOPOS. There is no polling outside the local handoff page.

This records declared provenance. It is not cryptographic attestation of a
provider, and a local process with the capability can participate. It grants no
TOPOS read/write permissions: the owner's normal app grant remains required.

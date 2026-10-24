# Agent-operation evidence and remaining gaps

Status: development candidate, 2026-10-24. A browser loading the extension or a
human selecting "AI agent" does not prove an agent can independently declare
itself. No browser has passed the complete agent-attribution acceptance flow yet.

## Chrome 155 on macOS: operator-assisted only

The owner loaded the extension, reopened its popup, entered the agent fields and
clicked Apply. The owner reported the successful assignment. The automation
tool's browser URL policy blocked access to the extension page; native popup
interaction was unreliable. This is evidence for manual attribution, not an
autonomous Chrome integration. The restriction was not bypassed.

## Safari 27.0.1 on macOS: agent-driven UI declaration observed

The owner approved installation/unsigned-extension and website permissions.
The agent then performed these actions using the native accessibility controls:

1. Selected **AI agent** in the extension popup.
2. Entered provider `OpenAI`, name `Codex`, source `codex_sessions`, and the
   synthetic parent `codex:browser-validation`.
3. Clicked **Apply to this tab**. The observed status became **Attributing this
   tab to Codex**, and the toolbar title became **TOPOS · Codex (OpenAI)**.
4. Navigated the test tab. The first attempt revealed that Safari replaced its
   tab ID and lost attribution. After the replacement handler was added, a
   repeated navigation retained **Codex · OpenAI** and the same source/parent
   fields in the reopened popup.
5. Selected **Me** and applied; the observed status became **You are now the
   controller**. Reset to unknown afterward.

These are observations from an interactive development session. They are not a
repeatable unattended integration test. The parent ID was synthetic and both
test installations were unattached to TOPOS. No production conversation link or
browser-to-node delivery was demonstrated by this session.

## Acceptance still required

- A repeatable agent-only flow after ordinary installation/permission setup.
- An actual provider integration or agent instructions that declare identity
  before browsing; ordinary native input does not reliably identify a bot.
- The agent obtains and supplies its real source-scoped conversation ID.
- A captured browser action reaches a test TOPOS node with that exact identity
  and parent, appears under the AI filter, and does not affect personal interests.
- Explicit human handoff and missing/expired declarations remain safe.

The approved-controller and tab-group protocols are implemented and unit-tested,
but neither was exercised with a real provider integration in this session.

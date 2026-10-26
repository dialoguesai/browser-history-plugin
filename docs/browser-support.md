# Browser and AI-control support

Development candidate tested on macOS, 2026-10-24. These results distinguish
identity transfer, payload capture, and a deployed node's canonical behavior.

| Environment | Automatic Codex identity + real parent | Capture / delivery | Limits |
|---|---|---|---|
| Chrome 155.0.8059.86 | Passed using the bundled local handoff, no identity form entry | Final queue-fix build reloaded and verified: two visits and one click returned HTTP 200 and matched exact live TOPOS 1.5.21 read-back | Renewed account grant required after Safari attachment revoked the earlier Chrome grant. Released node does not preserve canonical actor attribution. Final cursor tab-switch/end check passed. |
| Safari 27.0.1 | Passed using the same helper, no identity form entry; retained across navigation/tab replacement | Attach Dialogues passed after callback deployment; HTTP 202 accepted into queue, followed by exact live TOPOS 1.5.21 read-back of one visit and five interactions | The released node does not preserve canonical actor attribution. Live proof used a temporary extension, not the signed package. |
| Chrome 155 driven by Claude in Chrome (Claude Desktop) | Not detected on its own: `navigator.webdriver` is false and its clicks are trusted events, so detection alone cannot identify it. The current default is human unless the agent declares control. Passed through the same local handoff with a Claude Code identity adapter (`claude_code_sessions`, real parent), no identity form entry | Visit and click returned HTTP 200 and matched exact live TOPOS 1.5.21 read-back | The bundled CLI's Claude adapter was then verified live the same way (visit and click, HTTP 200, exact read-back). |
| Dia (Chromium) | Not tested with the new handoff | Prior unlabelled Example.com activity observed in TOPOS | Group/debugging UI alone cannot supply a parent ID. |
| Edge / Arc / other Chromium | Not tested with this candidate | Not tested | No live compatibility claim. |

The pointer was refined in two design passes at 16, 20, 24 and 32 CSS pixels
on light and dark backgrounds: a larger pure-black center, a white outline drawn
last so it stays visible, and a black outer edge for light toolbars. The refined
Chrome and Safari cursors were visually verified on an agent tab, absent on an unassigned
tab, present again when returning to the agent tab, and cleared after automatic
session end. Captured tab-switch records retained the original agent/session
and parent. Ordinary tabs now default to human (`default_human`) with a clean icon; named
agents and positive automation evidence retain their own attribution. Normal browser permission/installation and owner account grants are still
required; they are not agent identity entry.

Both browsers' real captured payloads passed the candidate node's ingestion,
canonical actor preservation, exact parent lookup, AI timeline filter, and
personal-enrichment exclusion checks in an isolated database. This is replay
acceptance, not evidence that those node changes are deployed.

See [agent-operation evidence](agent-validation.md), [automatic handoff](agent-bridge.md)
and [Safari packaging and callback setup](safari.md). The 29 extension tests
cover actor validation, event time, tab replacement, sender validation, delayed
delivery, HTTP handoff (including a live-discovered pending-queue deadlock), OAuth state, per-tab cursor isolation, same-tab human handback without relabeling queued AI actions, installation-local credentials/names, and stale content-script device-name rejection.

Coordinated draft changes:
[plugin #2](https://github.com/dialoguesai/browser-history-plugin/pull/2),
[node #195](https://github.com/dialoguesai/topos/pull/195),
[control plane #170](https://github.com/dialoguesai/control-plane/pull/170),
[timeline #161](https://github.com/dialoguesai/topos-react-app/pull/161).
They do not select or change the node's release version.

The Safari-only callback fix was deployed and merged as
[control plane #178](https://github.com/dialoguesai/control-plane/pull/178).
The owner also confirmed that switching from the AI tab to their own Safari tab
cleared the pointer. Explicit same-tab Me mode was checked separately in the
live popup; this is not automatic human takeover detection.

Independent browser grants are implemented and deployed in
[control plane #181](https://github.com/dialoguesai/control-plane/pull/181).
Updated clients keep a stable installation UUID, credentials and Device name in
local browser storage. A reconnect replaces grants only for that installation;
other browsers/profiles and historical grants with unknown installation survive.
Normal consent, scopes, expiry, PKCE and explicit revocation still apply. Older
clients fall back to callback identity, which cannot distinguish Chrome profiles
sharing one extension ID. The Device name row is visible above all settings tabs;
renaming a browser does not change its installation identity.

Simultaneous attachment passed live on 2026-10-24: after Safari renewed its
grant, Chrome delivered a visit and click with HTTP 200 (matched in TOPOS read-back),
and Safari's own later activity also reached TOPOS. Neither browser needed reattaching.

Still unverified: a signed/notarized Safari distribution, a complete browser restart cycle,
real child-tab inheritance and approved external-controller integrations.

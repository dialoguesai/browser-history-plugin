# Browser and AI-control support

Development candidate tested on macOS, 2026-10-24. These results distinguish
identity transfer, payload capture, and a deployed node's canonical behavior.

| Environment | Automatic Codex identity + real parent | Capture / delivery | Limits |
|---|---|---|---|
| Chrome 155.0.8059.86 | Passed using the bundled local handoff, no identity form entry | Actual attributed visit captured; normal TOPOS write succeeded; matching URL/time read back from running TOPOS 1.5.20 | Released node 1.5.20 does not preserve/expose the new actor envelope. Final cursor tab-switch/end check passed. |
| Safari 27.0.1 | Passed using the same helper, no identity form entry; retained across navigation/tab replacement | Actual attributed visits and tab activations received by local verifier; exact parent preserved | Live TOPOS attachment blocked by missing Safari callback registration in the deployed control plane. Fix is prepared and tested, not deployed. |
| Dia (Chromium) | Not tested with the new handoff | Prior unlabelled Example.com activity observed in TOPOS | Group/debugging UI alone cannot supply a parent ID. |
| Edge / Arc / other Chromium | Not tested with this candidate | Not tested | No live compatibility claim. |

Chrome and Safari cursors were visually verified on an agent tab, absent on an unassigned
tab, present again when returning to the agent tab, and cleared after automatic
session end. Captured tab-switch records retained the original agent/session
and parent. Human/unknown remain distinct in payloads despite sharing a clean
icon. Normal browser permission/installation and owner account grants are still
required; they are not agent identity entry.

Both browsers' real captured payloads passed the candidate node's ingestion,
canonical actor preservation, exact parent lookup, AI timeline filter, and
personal-enrichment exclusion checks in an isolated database. This is replay
acceptance, not evidence that those node changes are deployed.

See [agent-operation evidence](agent-validation.md), [automatic handoff](agent-bridge.md)
and [Safari packaging and callback setup](safari.md). The 19 extension tests
cover actor validation, event time, tab replacement, sender validation, delayed
delivery, HTTP handoff, OAuth state, and per-tab cursor isolation.

Coordinated draft changes:
[plugin #2](https://github.com/dialoguesai/browser-history-plugin/pull/2),
[node #195](https://github.com/dialoguesai/topos/pull/195),
[control plane #170](https://github.com/dialoguesai/control-plane/pull/170),
[timeline #161](https://github.com/dialoguesai/topos-react-app/pull/161).
They do not select or change the node's release version.

Still unverified: full Safari grant-to-live-node delivery after deployment,
a signed/notarized Safari distribution, a complete browser restart cycle,
real child-tab inheritance and approved external-controller integrations.

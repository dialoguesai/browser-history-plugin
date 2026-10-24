# Browser and AI-control support

Status: development candidate, 2026-10-24. This is a capability matrix, not a
claim that every bot can be detected automatically.

| Environment | Extension loading / capture | Explicit AI identity + parent | Automatic signals | Evidence |
|---|---|---|---|---|
| Google Chrome 155.0.8059.86 (macOS) | Unpacked install confirmed; worker and popup running; capture delivery not yet live-tested | Owner confirmed successful Codex/OpenAI assignment with a source-scoped parent in the popup | A controlled tab correctly remained unknown without a declaration; no universal bot detection claim | Native toolbar/popup inspected; owner completed identity form because browser automation policy blocks extension URLs |
| Dia (Chromium) | Existing activity capture observed | Candidate implementation not yet loaded | Agent tab group and browser debugging infobar observed; neither supplies a conversation ID | Example.com visit observed in TOPOS before attribution changes |
| Safari 27.0.1 (macOS) | Temporary extension loaded and enabled; worker and popup running; capture delivery not yet live-tested | Codex/OpenAI + parent assignment, popup reopening, page reload, URL navigation and human/unknown handoff passed | Native agent input alone remained unknown. Group and external-controller APIs are not validated | Live native-UI test found tab-ID replacement on navigation; `tabs.onReplaced` history transfer fixed it and the repeated navigation test retained the same named parent |
| Edge / Arc / other Chromium | Not tested for this candidate | Expected to share Chromium APIs, unverified | Unverified | No compatibility claim |

A browser's ability to run the extension is separate from an agent provider's
ability to declare its conversation. Codex's observed group/debugging UI alone
cannot supply the parent ID. Cooperative explicit declaration is required for
named, conversation-linked attribution. Unknown actions stay unknown.

The tested support is **explicit AI-controlled tab mode** in Chrome and Safari,
with the narrower Chrome checks described above. It is not automatic provider or
conversation discovery, a signed Safari distribution, or a live TOPOS delivery
certification. Both browser test installations stayed unattached to TOPOS.
The 11 extension tests cover actor validation, event-time history, replacements,
leases, sender validation, group observation and delayed delivery/retries.

The coordinated implementation is under review in
[TOPOS node #195](https://github.com/dialoguesai/topos/pull/195),
[control plane #170](https://github.com/dialoguesai/control-plane/pull/170), and
[timeline #161](https://github.com/dialoguesai/topos-react-app/pull/161).
Node/UI verification uses synthetic records and temporary databases. Live
extension-to-node delivery, restart behavior in each browser, child tabs,
and approved-controller integration remain release acceptance checks.

Chrome setup: open chrome://extensions yourself, turn on Developer mode, choose
Load unpacked, and select the extension folder. Do not attach a test installation
to production merely to test actor assignment.

Safari setup depends on the installed release. Apple's development workflow
supports temporary web-extension folders on recent Safari versions; older
versions require conversion/package steps. See [Apple's running guide](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
and [API compatibility guide](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).

Acceptance checks: installation errors; unknown default; explicit agent identity
and parent; navigation retention; handoff to human; child-tab inheritance; late
follow-up; browser restart; capture delivery into a test node; timeline filters;
AI/unknown exclusion from personal interests. Record browser version and tested
agent/control method with results. Do not turn a failed or unperformed test into
a supported claim.

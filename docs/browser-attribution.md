# Browser controller attribution

Version 3.1 adds an independent `actor` envelope to every captured visit, click,
highlight, star and video event. The authenticated writer remains the plugin.
The actor describes the controller of the tab at the event's time.

## Use it

Open the toolbar popup and choose **Me**, **AI agent**, or **Unknown / detect
automation**. AI mode requires the provider, agent name, conversation source ID
and conversation ID; a turn ID is optional. Use the source's canonical ID,
including its namespace prefix (for example `codex:…` in `codex_sessions`). The
reference remains valid if the chat source has not synced the parent yet.

Mode follows a tab across navigation. Explicit AI mode is inherited by tabs
opened from that tab. Switch to **Me** when taking over. Closing the tab or
restarting the browser clears its mode. Unknown is the default: the absence of
an automation signal never proves a human was responsible.

When a browser replaces the underlying tab during navigation, the replacement
keeps its actor history, session and lease. An explicit choice already made on
the new tab takes precedence. This path is exercised by Safari URL navigation.

## Integrations without a native helper

An agent able to name a Chromium tab group can declare its identity before
browsing. Set the entire group title to:

```js
'[TOPOS AI] ' + [agentName, provider, conversationSource, conversationId]
  .map(encodeURIComponent).join(' | ')
```

This is a cooperative declaration, not authenticated proof of provider identity.
A human can edit the title. Ordinary emoji/group names are not treated as AI.
Owners can optionally list exact known agent group names in the popup; these
are only automation hints and do not invent a provider or parent conversation.
An explicit per-tab choice takes precedence over a group declaration.

An approved controller extension can call:

```js
const response = await chrome.runtime.sendMessage(toposExtensionId, {
  type: 'topos.actor.begin',
  tab_id: controlledTabId,
  lease_minutes: 30,
  actor: {
    kind: 'agent', provider: 'example-provider', name: 'Example agent',
    conversation_source: 'codex_sessions',
    conversation_id: 'codex:example-conversation'
  }
});
// On handoff/end, use the session ID returned by begin:
await chrome.runtime.sendMessage(toposExtensionId, {
  type: 'topos.actor.end', tab_id: controlledTabId,
  session_id: response.actor.session_id
});
```

The owner must allowlist the controller's extension ID first. Web pages and
content scripts cannot set identities. A stale controller cannot end a newer
session. Leases expire to unknown. The integration does not create a new TOPOS
principal or give its caller extra access to data.

## Detection and delayed tab-switch delivery

Positive `navigator.webdriver` and synthetic-event hints can flag automation;
`false`/trusted events cannot prove a human. Ordinary website scripts can also
create synthetic events. A detected but unidentified controller is recorded as
`automation`, never guessed to be a particular provider. A page banner offers
the extension's identity form. It cannot enforce a gate against arbitrary OS
input or non-cooperating agents.

Visits/tab activations wait up to 2.5 seconds for same-tab follow-up evidence.
A matching document signal can resolve unknown activity, or add identity to an
automation hint, before that deadline. The envelope records `method: followup`
and the identity method; this is a bounded correlation, not proof of who acted
earlier. Expired/unresolved entries stay unknown. Sent history is not relabelled.

Per-tab history avoids assigning a late event to a new controller. Session
storage survives MV3 worker suspension, not browser shutdown. A recovery alarm
flushes pending visits; stable capture IDs make TOPOS retries idempotent. The
optional legacy Supabase sink needs `tables/add_browser_actor.sql` plus the
corresponding Options checkbox to retain actors and deduplicate capture IDs.

## TOPOS integration

Coordinated node/control-plane/frontend changes preserve the envelope in raw
and canonical activity, expose it in owner recall and timeline results, and add
**All controllers / Human browsing / AI / bot browsing / Unknown browsing**.
Filtering happens before counts and pagination. Collapsed runs do not combine
different controllers, agent sessions or parent conversations.

AI, automation and unknown browser activity stays searchable but does not feed
personal entities, topics, goals, facts or monthly interests. Existing mixed
interest clusters cannot release a label until rebuilt from eligible human
activity. Legacy records without an actor stay unknown; this is not retroactive
proof of human browsing. Existing previously derived personal facts are not
automatically deleted by this change.

The plugin alone cannot update an older node or frontend. Deploy the coordinated
changes before relying on downstream personal-interest exclusion or the filter.
Provider identity is declared provenance, separate from authenticated ingestion.

## Validation

Run `npm test` (Node 22+, no dependencies). Browser compatibility and live-test
results are recorded separately in [browser-support.md](browser-support.md).

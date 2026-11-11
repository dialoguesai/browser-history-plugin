---
name: topos-browser-attribution
description: Attribute browser control by {{NAME}} to its current chat in TOPOS. Use before controlling a tab in a user browser with the TOPOS extension, including native computer use; release attribution when control ends. Excludes search tools and connector API calls.
---

# TOPOS browser attribution

Before browsing, declare {{NAME}} / {{PROVIDER}} and the real current conversation to TOPOS. Native input can look human, and browser badges alone cannot link the chat.

1. Select the user's requested browser/profile using its supported tools. Inventory and handoff setup can happen before attribution. Do not install the extension in other profiles automatically.
2. Run the adjacent `scripts/cli.mjs` with Node 20+ in this chat's shell:

   `node <absolute path to this skill>/scripts/cli.mjs --agent {{TOOL}} --url <task destination URL> --lease-minutes 15`

   Resolve the skill path from this file's location and quote arguments appropriately for the current shell. Keep the helper in a managed process session (a PTY where available), retain its process handle, target tab ID, `launch_url`, `end_url`, and `expires_at`. Use normal approval mechanisms if localhost binding requires it; never weaken permissions.
3. Open `launch_url` in the tab to control. Prefer a new tab; preserve existing destinations and unsaved work. Wait until **Attributed to {{NAME}}** is visible. Verify provider **{{PROVIDER}}**, source **{{SOURCE}}**, and the current chat's ID. The adapter reads {{IDENTITY}}. Missing/conflicting IDs are errors: never fabricate them or reuse another chat's identity.
4. Use **Continue** and work in that same tab. Each independently controlled tab needs a separate helper/handoff. Before expiry, use a fresh helper and verify a fresh handoff in the same tab; then stop the superseded helper. Do not reuse expired sessions.
5. Before ending the turn, yielding to the user, or waiting for input, open `end_url` in the same tab and verify **Agent control ended**, then stop that exact helper. Preserve and restore the user's final page where safe. If navigation would lose unsaved state, use TOPOS's controller UI to switch that tab to **Me** and verify the handback. A closed tab loses its attribution; stop its helper. Stopping a helper alone does not clear the extension's lease immediately.

Use the work tool's supported browser/computer APIs. Do not fake favicons or modify browser profile files. If handoff fails, do not silently continue with AI actions recorded as human; diagnose, use a connector if appropriate, or report the blocker. If release cannot be verified, stop browser actions and report the lease expiry.

This setup records declared provenance; it grants no account access. Existing browser permissions and Attach Dialogues remain required. It does not authorize unrelated tasks or bypass approvals. Do not publish handoff capability URLs. Web searches, API connectors, isolated headless rendering, and browsers without TOPOS are outside this workflow. Remote/cloud agents cannot reach the user's loopback helper unless they run on the same computer as the browser.

Instructions guide cooperating agents; they are not browser-level enforcement. A cursor indicates AI control. A named detection signal without a handoff does not establish the parent conversation. Conversation links need that chat source synced into TOPOS.

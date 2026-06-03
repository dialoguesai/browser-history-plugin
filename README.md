<p align="center">
  <img src="icons/icon-48.png" alt="Dialogues Browser Extension" width="96" height="96" />
</p>

<h1 align="center">Dialogues Browser Extension</h1>

<p align="center">
  <strong>Your browsing history, in your Topos — on your terms.</strong>
</p>

<p align="center">
  Connect once with <strong>Attach Dialogues</strong>, and visits, stars, and browser events flow into <strong>your</strong> personal Dialogues database.
</p>

<p align="center">
  <em>Chrome · Arc · Edge (Chromium) · Manifest V3</em>
</p>

---

## Why use it

Your browser already keeps browsing history. You can search it, scroll it, and reopen old tabs—but it stays **trapped in the browser**: hard to combine with the rest of your life, hard to query as structured data, and not something **your own agents** can reason over.

**Attach Dialogues** sends that activity into **your Topos** as a normal data source. Once it is there, it lives inside the Topos ecosystem—alongside messages, notes, and other streams—so you can search, filter, and build on it like any other signal on your node. Your agents can turn raw visits into **useful signal**: what you researched, what you returned to, what changed over time—not just a list of URLs in a history panel.

| You get | What it means |
|--------|----------------|
| **History that works for you** | Browsing becomes structured ingest in your node, not a siloed browser archive. |
| **Topos-native access** | Query and explore visits in the same place as the rest of your personal data. |
| **Agent-ready signal** | Your Topos agents can summarize, connect, and act on browsing alongside your other sources. |
| **One-click attach** | Grant Access through Dialogues—no API keys pasted into the extension for Topos. |
| **Your database** | Records land in **your** Topos via the Control Plane; content is not held as a shared SaaS browsing log. |
| **You stay in control** | Revoke anytime in Dialogues → **Sharing → Connected apps**. |
| **Skip what you want** | Block domains you do not want recorded (work tools, banks, etc.). |

---

## What it captures

When Topos is attached, the extension sends structured events to your node:

| Type | Examples |
|------|-----------|
| **Visits** | URL, title, time, hostname, favicon, tab/window context |
| **Events** | Clicks, highlights, tab switches, video play (where supported) |
| **Starred sites** | Pages you star from the extension |

You choose what matters; skip lists keep noise out of your graph.

---

## How it works

```text
  You browse  →  Extension  →  Dialogues Control Plane  →  Your Topos engine
                     │
                     └─ (optional) Your Supabase project
```

1. **Install** the extension (see below).
2. Open **Options → Topos** and click **Attach Dialogues**.
3. Sign in and approve access on Dialogues (standard consent screen).
4. Browse as usual—activity syncs in the background.

**Access** lasts until you revoke it. After attach, you typically do not need to reconnect unless you revoke access or clear extension storage.

---

## Install (from this repo)

For **GitHub / development** installs (each machine gets its own extension ID):

1. Open extensions:
   - **Chrome:** `chrome://extensions`
   - **Arc:** `arc://extensions`
   - **Edge:** `edge://extensions`
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (`browser-plugin/`, the one with `manifest.json`).
4. Pin the extension from the toolbar for quick access to **Options**.

On first open of **Options → Topos**, redirect URIs for your install are registered automatically so Attach can complete.

> **Chrome Web Store:** A store listing may use a fixed extension ID; install steps will match the store page when published.

---

## Options

| Tab | Purpose |
|-----|---------|
| **Topos** | Attach / detach Dialogues, connection status, link to Connected apps |
| **Supabase** | Optional: your project URL + anon key to mirror writes |
| **Skip domains** | Hostnames to exclude from recording |
| **Advanced** | Redirect retry, debugging |

Topos is the **default path**. Supabase is optional and clearly separate—you never need Supabase to use Dialogues.

---

## Privacy & trust

- **Attach uses Grant Access (PKCE)**—the extension does not ship with a Dialogues platform secret.
- **Ingest goes to your `resource_id`**—the dataset you approved during consent.
- **Revoke is immediate** from the Dialogues UI; the extension stops writing on the next request.
- **Skip domains** reduce sensitive or low-signal hosts before they leave the browser.

For technical detail on auth and ingest, see the [developer documentation](../topos-website-v2/docs/third-party/THIRD_PARTY_APP_CAPABILITIES.md).

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Nothing syncing | Confirm **Attach Dialogues** is active on the Topos tab. |
| Arc blocked attach | Reload the extension; ensure Options completed redirect setup (uses `chromiumapp.org` callback). |
| 401 / 403 after working | Access may be revoked—reattach, or check **Connected apps** in Dialogues. |
| Debug logging | `chrome://extensions` → **Dialogues Browser Extension** → **Service worker** → Console (`[NAV]`, `[APP_INGEST]` lines). |

---

## For developers & integrators

This repo is the **reference third-party app** (`app_id`: `browser-plugin`) for Grant Access + `app_ingest` on the Dialogues platform.

| Resource | Link |
|----------|------|
| Integrator walkthrough | [INTEGRATION.md](../topos-website-v2/docs/third-party/INTEGRATION.md) |
| Full capability map | [THIRD_PARTY_APP_CAPABILITIES.md](../topos-website-v2/docs/third-party/THIRD_PARTY_APP_CAPABILITIES.md) |
| Release checklist | [RELEASE_CHECKLIST.md](../topos-website-v2/docs/third-party/RELEASE_CHECKLIST.md) |
| All Phase 2 docs | [topos-website-v2/docs/README.md](../topos-website-v2/docs/README.md) |

Operator registration (one-time): `topos-control-plane/scripts/register_browser_plugin_app.sh`.

---

## Version

**3.0.0** — Dialogues Browser Extension (Manifest V3)

<p align="center">
  <sub>Dialogues · Topos personal node · <a href="../topos-website-v2/docs/README.md">Documentation</a></sub>
</p>

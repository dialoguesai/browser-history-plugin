<p align="center">
  <img src="icons/icon-48.png" alt="Dialogues Browser History" width="96" height="96" />
</p>

<h1 align="center">Dialogues Browser History</h1>

<p align="center">
  <strong>Your browsing history, in your Topos — on your terms.</strong>
</p>

<p align="center">
  <a href="https://github.com/DialoguesAi/browser-history-plugin">GitHub</a>
  ·
  <code>app_id</code>: <code>browser-history-plugin</code>
  ·
  Chrome · Arc · Edge (Chromium) · Manifest V3
</p>

<p align="center">
  Connect once with <strong>Attach Dialogues</strong>, and visits, stars, and browser events flow into <strong>your</strong> personal Dialogues database.
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
```

1. **Install** the extension (see below).
2. Open **Options → Topos** and click **Attach Dialogues**.
3. Sign in and approve access on Dialogues (standard consent screen).
4. Browse as usual—activity syncs in the background.

**Access** lasts until you revoke it. After attach, you typically do not need to reconnect unless you revoke access or clear extension storage.

Registered on Dialogues as app **`browser-history-plugin`** (public PKCE client; no platform secret in the extension).

---

## Install from GitHub

```bash
git clone https://github.com/DialoguesAi/browser-history-plugin.git
cd browser-history-plugin
```

Each unpacked install gets its own extension ID. **Load unpacked** in Chromium:

1. Open **Chrome** `chrome://extensions`, **Arc** `arc://extensions`, or **Edge** `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the cloned folder (the directory that contains `manifest.json`).
4. Pin the extension for quick access to **Options**.

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

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Nothing syncing | Confirm **Attach Dialogues** is active on the Topos tab. |
| Arc blocked attach | Reload the extension; ensure Options completed redirect setup (uses `chromiumapp.org` callback). |
| 401 / 403 after working | Access may be revoked—reattach, or check **Connected apps** in Dialogues. |
| Debug logging | `chrome://extensions` → **Dialogues Browser History** → **Service worker** → Console (`[NAV]`, `[APP_INGEST]` lines). |

---

## For developers

This repository is the reference **third-party Chrome extension** for Dialogues Grant Access + `app_ingest`.

| Item | Value |
|------|--------|
| Registry `app_id` | `browser-history-plugin` |
| Auth | `public_pkce` (S256); no `client_secret` in the CRX |
| Key modules | `lib/grantAccess.js`, `lib/pkce.js`, `lib/registerRedirect.js`, `lib/toposIngest.js` |

Operator registration (Control Plane): register the app with integration profile **chrome_extension** and `client_auth_mode` **public_pkce**, or use your platform’s app registry (App Sheaf) with the same policy.

---

## License

Copyright 2026 Dialogues and contributors.

Licensed under the [Apache License, Version 2.0](LICENSE).

---

## Version

**3.0.0** — Dialogues Browser History (Manifest V3)

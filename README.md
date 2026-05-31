# Browser Plugin

This is meant to be a plugin to submit Browsing data to one's Topos.

## Loading the extension (Chrome / Arc / Edge)

1. Open your browser's extensions page:
   - **Chrome:** `chrome://extensions`
   - **Arc:** `arc://extensions`
   - **Edge:** `edge://extensions`
2. Enable **Developer mode** (toggle in the top-right).
3. Click **Load unpacked** and select this folder (`browser-plugin/` — the one that contains `manifest.json`).
4. Optional: pin the extension from the toolbar or Site Controls menu so Options is easy to reach.

Each unpacked install gets a **unique extension ID**. You must register that ID with Control Plane before **Attach Dialogues** will work (see below).

## Where to see extension logs (one place for all tabs)

You do **not** need to open the console on every new tab or page. The code that sends visits runs in the **extension’s background (service worker)**. Use a single console for all activity:

1. Open **`chrome://extensions`** or **`arc://extensions`**
2. Find **URL Logger / Dialogues Browser Extension**
3. Click **“Service worker”** (or “Inspect views: background page”)  
   → DevTools opens for the **background script**
4. In that console you’ll see:
   - **`[NAV] Page loaded: ...`** — every navigation the plugin records
   - **`[APP_INGEST] Sending to Control Plane: ...`** — when a visit is sent (only if “Attach Dialogues” is active)
   - **`[APP_INGEST] Not sending: no dialoguesToken ...`** — when “Attach Dialogues” is not active
   - **`[APP_INGEST] Failed ...`** or **`Successfully sent visit`** — result of the request

Keep this **Service worker** DevTools window open while you browse; all visits from any tab will log here.

## App Registry (Control Plane)

The plugin is registered in the Control Plane **app registry** as a first-party app. When requesting user permission (e.g. “Attach Dialogues” / UMA flow), the plugin must use this stable identifier:

- **`app_id`:** `browser-plugin`  
- **Name:** Dialogues Browser Extension  

One-time app registration (creates the app row only) is done via script in the Control Plane repo: `scripts/register_browser_plugin_app.sh` (requires `CONTROL_PLANE_URL` and `CONTROL_PLANE_ADMIN_KEY`).

### Register your redirect URI (required for each local install)

**Attach Dialogues** sends users through Control Plane OAuth with a callback to your extension's Options page. Control Plane only accepts redirect URIs that are explicitly allowlisted for the app.

When you **Load unpacked**, the browser assigns an extension ID that is unique to that install (and to the folder path). A redirect URI registered for someone else's Chrome install will **not** work on your Arc or dev Chrome install.

#### 1. Find your extension ID and redirect URIs

On `chrome://extensions` or `arc://extensions`, find **URL Logger to Supabase** and copy the **ID** (32 lowercase letters), e.g. `nhchpdllklekegfalgklbeedainhjjif`.

Register **both** of these redirect URIs for your install:

```text
chrome-extension://<YOUR_EXTENSION_ID>/options.html
https://<YOUR_EXTENSION_ID>.chromiumapp.org/
```

The `chromiumapp.org` URI is used by **Attach Dialogues** via `chrome.identity.launchWebAuthFlow` (required on **Arc**, which blocks top-level navigation to `chrome-extension://` after OAuth with `ERR_BLOCKED_BY_CLIENT`).

You can confirm the active `redirect_uri` in the Options page DevTools console after clicking **Attach Dialogues** — the plugin logs the full `/connect` URL.

#### 2. Add the redirect URI to Control Plane

Requires `CONTROL_PLANE_ADMIN_KEY` and access to `PATCH /v1/apps/browser-plugin`.

**First, fetch existing URIs** so you don't remove other developers' installs:

```bash
export CONTROL_PLANE_URL="https://cp.logu3s.com"   # or http://localhost:8000 for local CP
export CONTROL_PLANE_ADMIN_KEY="your-admin-key"

curl -s -H "Authorization: Bearer ${CONTROL_PLANE_ADMIN_KEY}" \
  "${CONTROL_PLANE_URL}/v1/apps/browser-plugin" | jq '.metadata.allowed_redirect_uris'
```

**Then PATCH** — this merges your URI into the existing list without removing other installs:

```bash
export EXTENSION_ID="YOUR_EXTENSION_ID"
export REDIRECT_OPTIONS="chrome-extension://${EXTENSION_ID}/options.html"
export REDIRECT_CHROMIUM="https://${EXTENSION_ID}.chromiumapp.org/"

curl -s -X PATCH "${CONTROL_PLANE_URL}/v1/apps/browser-plugin" \
  -H "Authorization: Bearer ${CONTROL_PLANE_ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(curl -s -H "Authorization: Bearer ${CONTROL_PLANE_ADMIN_KEY}" \
    "${CONTROL_PLANE_URL}/v1/apps/browser-plugin" \
    | jq --arg a "$REDIRECT_OPTIONS" --arg b "$REDIRECT_CHROMIUM" \
      '.metadata.allowed_redirect_uris += [$a, $b] | {allowed_redirect_uris: .metadata.allowed_redirect_uris | unique}')"
```

On success, `allowed_redirect_uris` in the response should include both URIs.

After changing extension code, **reload the extension** on `arc://extensions` (click the reload icon) so the new `identity` permission and Arc-safe attach flow take effect.

If attach fails with **`invalid_redirect_uri`** or **"redirect_uri is not registered for this app"**, this step was skipped or the wrong ID was used.

#### 3. Set the client secret in Options

The `browser-plugin` app uses **`client_secret_required`** mode. Paste the app client secret (`cas_...`) into **Dialogues Client Secret** on the extension Options page before attaching. Without it, `/connect/exchange` fails after login.

To issue or rotate a secret (admin only):

```bash
curl -s -X POST "${CONTROL_PLANE_URL}/v1/apps/browser-plugin/client-auth/issue" \
  -H "Authorization: Bearer ${CONTROL_PLANE_ADMIN_KEY}"
```

The response includes `client_secret` once — store it securely and enter it in Options.

---

## "Attach Dialogues" Flow

**"Attach Dialogues"** enables the browser plugin to write browsing data directly to your Dialogues database via the Control Plane, without requiring direct Supabase credentials.

The plugin uses the universal Grant Access flow via `GET /connect` + one-time code exchange at `POST /connect/exchange`.

> Client auth note: the app `browser-plugin` now uses `client_secret_required` mode. Set the app secret in Options as **Dialogues Client Secret** so the extension can include it during code exchange.

### How It Works

1. **User clicks Attach Dialogues (Grant Access)** in the plugin Options page.
2. **Consent flow:** User is redirected to Control Plane `GET /connect` with `app_id`, `redirect_uri`, `source_id`, and `scopes`.
3. **One-time code callback:** Control Plane redirects back to plugin options with `?code=...`.
4. **Exchange:** Plugin calls `POST /connect/exchange` with `code`, `app_id`, and `client_secret`, then receives token artifact + `resource_id`.
5. **Plugin stores credentials:** Token and resource_id are saved in `chrome.storage.sync`.
6. **Automatic data sync:** When attached, plugin sends browsing data to Control Plane via `POST /v1/ingestion/app_ingest`.

### Access Duration

- **Permission:** Access lasts **until you revoke it** (no time limit)
- **Token:** The RPT token is valid for **1 year** (configurable in Keycloak)
- **Set it and forget it:** After attaching, the plugin will continue writing data for 1 year without requiring re-attachment, unless you revoke access

### What Data Is Sent to Control Plane

When "Attach Dialogues" is active, the plugin sends the following data to the Control Plane. The Control Plane **forwards the records to your Dialogues engine** (your database); it does **not** store the actual record content. It only stores event metadata (e.g. counts per app/source) in Supabase for analytics and for 3rd party app insights.

#### Browser Visits (`source_id: "browser_visits"`)
- URL, title, visited timestamp
- Hostname, favicon URL
- Device name, tab/window IDs
- Navigation metadata (transition type, incognito status, etc.)

#### Browser Events (`source_id: "browser_events"`)
- Clicks, highlights, stars
- Video playback events
- Tab activation events

#### Starred Websites (`source_id: "starred_websites"`)
- Pages you've starred using the plugin

### Managing Access

- **View connected apps:** Open Dialogues frontend → **Sharing** → **Connected apps**
- **See entry counts:** The Connected apps table shows how many entries each app has written. These counts come from **your own database (engine)** — the Control Plane does not store your browsing data; it only stores event metadata (counts) for analytics.
- **Revoke access:** Click **"Revoke (detach)"** in Connected apps to stop the app from writing. After revoke, the plugin will receive 403 on the next write and should show an error badge.
- **Re-attach:** After revoking, you can click "Attach Dialogues" again to grant access; a new permission is created and writes resume.

### Error Handling

- **Arc: `ERR_BLOCKED_BY_CLIENT` / "blocked by Arc" on extension ID:** Arc blocks OAuth callbacks that navigate a normal tab to `chrome-extension://...`. Reload the extension (uses `chrome.identity.launchWebAuthFlow` instead) and ensure `https://<YOUR_EXTENSION_ID>.chromiumapp.org/` is registered (see **Register your redirect URI** above).
- **401/403 errors:** If the token expires or is revoked, the plugin will show an error badge and stop sending data. If the token keeps expiring soon after attach, see **Token goes inactive** in `app_registry_sprints/CONNECT_APP_FLOW.md` (set Keycloak Access Token Lifespan = 365 days on the resource server client).
- **Re-attach required:** If you see connection errors, try clicking "Attach Dialogues" again to get a new token
- **Check logs:** Use the Service worker console (see above) to see detailed error messages

---

Done:
- [x] Plugin
- [x] Saves browsing data with lots of tab url data
= [x] A plugin UI that allows one to put in their Supabase information
- [ ] Captures videos played
- [ ] Captures mouse activity, such as highlighted text
- [ ] Add information if switched and returned to a tab (at present, if a tab is open and used repeatedly over an extended period of time, its continuous usage isn't marked, and that would be useful information to have.)


Needs:
- [ ] Improve the settings page
- [ ] Separate table for media consumed
- [x] Separate table for "Starred" pages or websites
- [ ] Add an analysis page to view browsing history
- [ ] Have a mental health component to track when someone is just clicking to click!
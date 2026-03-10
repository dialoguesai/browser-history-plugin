# Browser Plugin Event Flow

How a navigation (or star) event from the browser plugin moves through the system and where it gets saved.

---

## High-Level Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Browser        │     │  Control Plane   │     │  User's Engine  │     │  Control Plane   │
│  Plugin         │────▶│  (app_ingest)    │────▶│  (Device A)     │     │  (Supabase)      │
│                 │     │                  │     │                 │     │  app_ingest_events│
└─────────────────┘     └──────────────────┘     └─────────────────┘     └──────────────────┘
      │                           │                         │                        │
      │ 1. User visits page       │ 2. Validate RPT         │ 3. PRIMARY STORAGE     │ 4. METADATA ONLY
      │    (or stars)             │    Forward to engine    │    Records in user's   │    For entry counts
      │                           │                         │    dataset             │    (optional)
```

---

## Detailed Sequence Diagram (Mermaid)

```mermaid
sequenceDiagram
    participant User
    participant Page as Web Page
    participant BG as background.js
    participant Storage as chrome.storage
    participant CP as Control Plane<br/>/v1/ingestion/app_ingest
    participant UMA as UMA / Keycloak
    participant Engine as User's Engine<br/>(Device A)
    participant Supabase as Supabase<br/>app_ingest_events

    User->>Page: Navigates (or clicks star)
    Page->>BG: chrome.webNavigation.onCompleted<br/>(or STAR_PAGE message)
    
    BG->>Storage: get dialoguesToken, dialoguesResourceId,<br/>dialoguesControlPlaneUrl
    alt Attach Dialogues is active
        BG->>BG: Build record: url, visited_at, title,<br/>favicon_url, hostname, device_name, ...
        BG->>CP: POST app_ingest<br/>Authorization: Bearer &lt;RPT&gt;<br/>body: { resource_id, source_id: "browser_visits", records: [record] }
        
        CP->>UMA: validate_write_permission(RPT, resource_id)
        UMA-->>CP: permission (app_id, permission_id, ...)
        alt Permission valid
            CP->>Engine: send_request(type: "app_ingest", payload: { user_id, dataset_id, source_id, schema_id, records })
            Note over Engine: PRIMARY STORAGE<br/>Records written to user's dataset<br/>via browser.visits.v1 parser
            Engine-->>CP: { status: "ok", payload: { records_processed, ... } }
            
            CP->>Supabase: POST app_ingest_events<br/>(optional metadata for counting)
            Note over Supabase: METADATA ONLY<br/>resource_id, app_id, source_id,<br/>records (JSONB), records_count
            Supabase-->>CP: 201 Created
            
            CP-->>BG: 200 OK { status: "ok" }
            BG->>BG: Log "[APP_INGEST] Successfully sent visit"
        else 401 or 403
            CP-->>BG: 401 Unauthorized or 403 Forbidden
            BG->>Storage: remove dialoguesToken, dialoguesResourceId
            BG->>User: Notification: "Dialogues Connection Expired.<br/>Please re-attach in options."
        end
    else Attach Dialogues not active
        alt Supabase configured
            BG->>Supabase: Direct insert to browserplugin table<br/>(legacy path)
        else
            BG->>BG: Log "Neither Supabase nor Dialogues configured"
        end
    end
```

---

## What Gets Saved Where

| Location | What is saved | Purpose |
|----------|----------------|---------|
| **User's Engine (Device A)** | **Primary.** Normalized browser visit records in the user's dataset. Schema: `browser.visits.v1`. Fields: `record_id`, `url`, `visited_at`, `title`, `favicon_url`, `hostname`, `device_name`, `tab_id`, `window_id`, `incognito`, `transition_type`, `pinned`, `audible`, `muted`, `opener_tab_id`, `referred_by`. | User's actual data; sync, search, and product features read from here. |
| **Control Plane → Supabase `app_ingest_events`** | **Metadata only (optional).** One row per app_ingest request: `id`, `resource_id`, `app_id`, `source_id`, `permission_id`, `records` (JSONB), `records_count`, `created_at`. | Entry counts and “Connected apps” UI (e.g. “X visits from browser plugin”) without querying the engine. |

---

## Record Shape (Plugin → Control Plane)

The plugin sends one record per navigation (or star). Example:

```json
{
  "resource_id": "dataset:owner-uuid:dataset-uuid:device-uuid",
  "source_id": "browser_visits",
  "records": [
    {
      "url": "https://example.com/page",
      "visited_at": "2026-02-05T15:30:00.000Z",
      "title": "Example Page",
      "favicon_url": "https://example.com/favicon.ico",
      "hostname": "example.com",
      "tab_id": 123,
      "window_id": 1,
      "incognito": false,
      "transition_type": "link",
      "pinned": false,
      "audible": false,
      "muted": false,
      "opener_tab_id": null,
      "device_name": "My Laptop",
      "referred_by": null
    }
  ]
}
```

---

## Component Summary

| Component | Role |
|-----------|------|
| **background.js** | Listens for navigation/star; if “Attach Dialogues” is active, builds the record and POSTs to Control Plane `app_ingest`. On 401/403, clears token and notifies user. |
| **Control Plane** | Validates RPT and permission, forwards payload to the user's engine, then optionally writes a metadata row to `app_ingest_events`. |
| **Engine (Device A)** | Receives `app_ingest` message; uses `browser_visits` source and `browser.visits.v1` parser; writes normalized records into the user's dataset (primary storage). |
| **Supabase `app_ingest_events`** | Stores metadata for counting and Connected apps UI; not the source of truth for the visit data. |

---

## "Token rejected" (401/403) immediately after re-attach

If you re-attach Dialogues and the very first visit still gets "Token rejected", the Control Plane (or Keycloak) is rejecting the token. To see the exact reason:

1. **Reload the extension** so the plugin logs the server response: in the Service Worker console you should see  
   `[APP_INGEST] Token rejected: 403 — Server says: <exact error>`.
2. **Check Control Plane logs** for:
   - `app_ingest validate_write_permission failed: ...`  
   - `app_ingest returning 403 to client: detail=...`  
   - `introspect_for_resource: ...` (e.g. "no match", "not found")

Common causes:

| Server message | Likely cause |
|----------------|--------------|
| **Token inactive or expired** | Keycloak introspection returns `active: false`. Check Keycloak introspection config and that the token is the RPT from connect-app (not a different token type). |
| **RPT does not grant read/write for this resource** | RPT permissions don’t match the resource’s `keycloak_resource_id` (e.g. rsid mismatch). Check UMA resource config and that the `resource_id` in the redirect matches the resource in the DB. |
| **No approved permission found for this resource and requester** | The `sub` in the RPT doesn’t match `requesting_user_id` on any approved permission, or the permission was revoked. The Control Plane normalizes the permission to the RPT's sub when you complete Attach Dialogues; re-attach once so the stored permission matches. If it still fails, check that the permission exists in uma_permissions and is status=approved. |
| **Resource not found** / **Resource has no Keycloak id** | The `resource_id` from the plugin isn’t in `uma_resources` or has no `keycloak_resource_id`. Check Supabase `uma_resources` and Keycloak resource setup. |

---

## Why you might see no rows in `app_ingest_events`

- **Data is written to `app_ingest_events` only after the engine has successfully stored the records.**  
  If the Control Plane returns **503** (e.g. “Owner’s engine is not connected”), it never writes to Supabase.
- **Check the extension’s Service Worker console** (see README: “Where to see extension logs”). You should see `[NAV] Page loaded:` on every navigation. If you see `[APP_INGEST] Not sending: no dialoguesToken`, complete “Attach Dialogues” in the options page.
- **Check Control Plane logs** for `app_ingest: request received ...`. If that never appears, the request is not reaching the Control Plane (wrong URL, CORS, or network). If you see it followed by 503, the user’s engine is not connected.

---

## File References

- Plugin: `browser-plugin/background.js` (navigation + star, app_ingest call)
- Control Plane: `control_plane/main.py` (`POST /v1/ingestion/app_ingest`)
- Engine handler: `topos/core/handlers.py` (app_ingest) or `engine/main.py`
- Source: `topos/sources/registry.py` (`browser_visits`)
- Parser: `topos/ingestion/parsers/browser_parser.py` (`browser.visits.v1`)
- Migration: `control_plane/supabase/migrations/20240205000000_create_app_ingest_events_table.sql`

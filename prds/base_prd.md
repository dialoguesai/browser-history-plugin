Product Requirements Document (PRD): URL Logger Browser Extension
1. Overview
A lightweight, cross‑browser extension that captures every top‑level page visit (and optionally inline video plays) and writes structured visit records into a user’s Supabase table for analytics, auditing, or personal archiving.

2. Objectives
Reliable logging of “meaningful” navigations (main‐frame loads) to Supabase

Configurable filtering via a built‑in and user‑extendable skip‑domain list

Rich metadata capture (URL, timestamp, page title, favicon, tab/window info, tab state)

Secure, user‑driven setup through an Options UI for Supabase credentials and filters

3. Key Features
3.1 Core Logging
Hook: chrome.webNavigation.onCompleted (MV3 service worker)

Capture:

url, visited_at (ISO timestamp)

title, favicon_url via chrome.tabs.get(details.tabId)

tab_id, window_id, incognito

transition_type (e.g. “link”, “typed”)

hostname (parsed)

Tab state: pinned, audible, muted, openerTabId

3.2 Skip‑Domain Filtering
Default blocklist:

Copy
Edit
airtable.com,
stripe.network,
js.stripe.com,
accounts.youtube.com,
accounts.google.com,
newassets.hcaptcha.com
User‑extendable via Options page

Matching: exact host or any subdomain

3.3 Options UI
Fields:

Supabase URL

Supabase anon‑key

Skip‑domains (one per line)

Storage: chrome.storage.sync (auto‑sync across user profiles)

Live reload: background worker re-reads settings on change

3.4 Supabase Integration
Table: browserplugin with columns

sql
Copy
Edit
id            UUID PRIMARY KEY,
url           TEXT,
visited_at    TIMESTAMPTZ,
title         TEXT,
favicon_url   TEXT,
tab_id        INTEGER,
window_id     INTEGER,
incognito     BOOLEAN,
transition_type TEXT,
hostname      TEXT,
pinned        BOOLEAN,
audible       BOOLEAN,
muted         BOOLEAN,
opener_tab_id INTEGER
Insertion: supabase.from('browserplugin').insert(record)

3.5 (Optional) Video‑Play Tracking
Content script listens to <video>.play events

Message: { type: 'VIDEO_PLAY', videoUrl, pageUrl, pageTitle, timestamp }

Background logs videoUrl as transition_type='video_play'

4. Non‑Functional Requirements
Manifest v3 compatibility (Chrome, Edge, Brave, Firefox)

Secure storage: never embed service‑role keys

Privacy: encourage Row‑Level Security policies on Supabase

Performance: ignore iframe navigations; efficient skip‑list lookup

Reliability: guard against uninitialized client; log errors clearly

5. Success Metrics
Logging coverage: ≥95% of user’s meaningful navigations

Filter accuracy: ≥99% of unwanted domains skipped

Latency: <200 ms from navigation completion to database insert

User satisfaction: positive feedback on configurability & usability

6. Milestones
MVP (Week 1)

Basic logging (URL + timestamp)

Hard‑coded skip list

Supabase DDL & insert

Configuration (Week 2)

Options page for creds & skip list

chrome.storage.sync integration

Merge default + user lists

Metadata enrichment (Week 3)

Capture title, favicon, tab/window IDs, incognito, transition type

Add pinned, audible, muted, openerTabId

Update Supabase schema

Video‑play tracking (Optional, Week 4)

Content script for <video>.play

Handle messages in background

Polish & publish (Week 5)

RLS policy guidance

Extension store packaging (Chrome Web Store, AMO)

Documentation & README

7. Open Questions
Should we batch inserts when navigating very quickly?

Do users need a popup UI to view recent logs locally?

Any other metadata (e.g. page language, meta description) worth adding?
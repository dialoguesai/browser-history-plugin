create extension if not exists "uuid-ossp";

-- create the visits table with all collected metadata
create table browserplugin (
  id               uuid        primary key default uuid_generate_v4(),
  url              text        not null,
  visited_at       timestamptz not null default now(),
  
  -- tab/page metadata
  device_name      text,
  title            text,
  favicon_url      text,
  tab_id           integer,
  window_id        integer,
  incognito        boolean,
  transition_type  text,
  hostname         text,

  -- additional tab state
  pinned           boolean,
  audible          boolean,
  muted            boolean,
  opener_tab_id    integer
);
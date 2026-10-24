-- Optional Supabase sink; TOPOS always receives actor metadata.
-- Apply before enabling “Actor columns installed” in connection settings.
ALTER TABLE public.browserplugin ADD COLUMN IF NOT EXISTS actor jsonb;
ALTER TABLE public.browserplugin ADD COLUMN IF NOT EXISTS capture_id text;
CREATE UNIQUE INDEX IF NOT EXISTS browserplugin_capture_id ON public.browserplugin(capture_id);
ALTER TABLE public.starred_websites ADD COLUMN IF NOT EXISTS actor jsonb;
ALTER TABLE public.starred_websites ADD COLUMN IF NOT EXISTS capture_id text;
CREATE UNIQUE INDEX IF NOT EXISTS starred_websites_capture_id ON public.starred_websites(capture_id);

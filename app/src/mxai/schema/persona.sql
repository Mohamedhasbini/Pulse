-- Layer 02 (persona.js): the owner's assistant settings per business.
-- { roles: { receptionist|support|sales: { on, guidelines } }, competitors: [..], never_say: [..], tone }
-- Empty means "defaults for this business model" (configOf fills them in), so existing businesses keep working.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_config JSONB NOT NULL DEFAULT '{}';

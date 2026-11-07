-- MXAi v2 database schema. Additive only (CREATE ... IF NOT EXISTS): a migration never destroys data.
-- pgvector: search by meaning (the db image includes it, db/Dockerfile)
CREATE EXTENSION IF NOT EXISTS vector;

-- Growth engine (app/src/engine): the lead quality lab. Companies first, people second; every fact keeps its source.
-- eng_clients: a business MXAi finds leads for (its "business brain": what it sells and who it sells to)
CREATE TABLE IF NOT EXISTS eng_clients (
  id SERIAL PRIMARY KEY,
  business_id INT,                               -- the matching MXAi business, when there is one
  name TEXT NOT NULL,
  website TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}',          -- offer, services, proof points, ideal customer, tone (AI draft, owner edits)
  status TEXT NOT NULL DEFAULT 'new',            -- new | ready | failed
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one row per company, keyed by its website domain
CREATE TABLE IF NOT EXISTS eng_companies (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  name_key TEXT,                                 -- normalised name (Al-, LLC, FZE removed) for duplicate checks
  website TEXT,
  city TEXT,
  country TEXT,
  sector TEXT,
  size_hint TEXT,
  description TEXT,
  tech JSONB NOT NULL DEFAULT '[]',              -- software seen on the website (Shopify, WordPress, a booking widget…)
  is_company BOOLEAN,                            -- false for directories, news, government pages
  found_via TEXT,                                -- osm | search | manual
  embedding vector(768),
  crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eng_companies_name_key ON eng_companies (name_key);
-- where every fact came from: the page, the exact quote, and when it was read
CREATE TABLE IF NOT EXISTS eng_facts (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES eng_companies(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  source_url TEXT,
  quote TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eng_facts_company ON eng_facts (company_id);
-- people and published addresses found on a company's own pages; emails are verified before use
CREATE TABLE IF NOT EXISTS eng_contacts (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES eng_companies(id) ON DELETE CASCADE,
  name TEXT,
  role TEXT,
  email TEXT,
  email_kind TEXT,                               -- published | pattern | generic
  email_status TEXT NOT NULL DEFAULT 'unchecked', -- unchecked | valid | catch_all | unknown | invalid
  phone TEXT,
  source_url TEXT,
  quote TEXT,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);
-- one lead-finding run for a client
CREATE TABLE IF NOT EXISTS eng_batches (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES eng_clients(id) ON DELETE CASCADE,
  size INT NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'queued',         -- queued | running | done | failed
  step TEXT,
  stats JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS eng_leads (
  id SERIAL PRIMARY KEY,
  batch_id INT NOT NULL REFERENCES eng_batches(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES eng_companies(id) ON DELETE CASCADE,
  contact_id INT REFERENCES eng_contacts(id) ON DELETE SET NULL,
  fit INT NOT NULL,                              -- 0-100
  similarity REAL,                               -- meaning match between the ideal customer and the company (pgvector)
  score REAL NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]',
  rank INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, company_id)
);
-- the owner's verdict on each lead: the quality bar is >= 70% "contact"
CREATE TABLE IF NOT EXISTS eng_grades (
  lead_id INT PRIMARY KEY REFERENCES eng_leads(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,                           -- contact | maybe | no
  reason TEXT,
  graded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lead pool (src/pool): a worldwide, consented B2C pool. Every person, every identity, every fact with its source,
-- every consent with its proof. Country rules decide what may be sent. Design: v2/docs/lead-pool-design.md
CREATE TABLE IF NOT EXISTS lp_persons (
  id SERIAL PRIMARY KEY,
  owner_client_id INT,                           -- the client whose channel captured this person (eng_clients.id)
  full_name TEXT,
  country TEXT,                                  -- ISO 3166-1 alpha-2 (stated, or from the phone number)
  city TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'new',            -- new | qualified | contacted | booked | won | lost
  score INT NOT NULL DEFAULT 0,                  -- 0-100: completeness + intent + freshness
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lp_persons_country ON lp_persons (country, city);
CREATE INDEX IF NOT EXISTS lp_persons_owner ON lp_persons (owner_client_id);
-- how to reach a person; value_hash (peppered SHA-256) finds the same person again
CREATE TABLE IF NOT EXISTS lp_identities (
  id SERIAL PRIMARY KEY,
  person_id INT NOT NULL REFERENCES lp_persons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                            -- email | phone | wa_id | ig_id
  value TEXT NOT NULL,                           -- normalised (lower-case email, E.164 phone)
  value_hash TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, value_hash)
);
-- every fact about a person with where it came from and how sure we are; sensitive keys are refused in code
CREATE TABLE IF NOT EXISTS lp_attributes (
  id SERIAL PRIMARY KEY,
  person_id INT NOT NULL REFERENCES lp_persons(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,                          -- form:<id> | meta_lead | google_lead | chat | import
  confidence REAL NOT NULL DEFAULT 1,            -- 1 = the person said it
  consent_id INT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE (person_id, key, source)
);
CREATE TABLE IF NOT EXISTS lp_interests (
  id SERIAL PRIMARY KEY,
  person_id INT NOT NULL REFERENCES lp_persons(id) ON DELETE CASCADE,
  vertical TEXT NOT NULL,
  intent TEXT,
  budget TEXT,
  timing TEXT,                                   -- now | 1-3 months | 3-6 months | later
  score INT NOT NULL DEFAULT 50,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS lp_interests_vertical ON lp_interests (vertical);
-- the exact consent wording shown, frozen: new wording = new row
CREATE TABLE IF NOT EXISTS lp_consent_texts (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one row per person x channel x purpose; proof = signed certificate over the recorded facts
CREATE TABLE IF NOT EXISTS lp_consents (
  id SERIAL PRIMARY KEY,
  person_id INT NOT NULL REFERENCES lp_persons(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                         -- email | sms | whatsapp | call | ai_call
  purpose TEXT NOT NULL,                         -- marketing | service
  buyers INT[] NOT NULL DEFAULT '{}',            -- named businesses (eng_clients ids)
  text_id INT REFERENCES lp_consent_texts(id),
  method TEXT NOT NULL,                          -- checkbox | double_opt_in | chat_yes | ad_form | import
  jurisdiction TEXT,
  source TEXT,
  page_url TEXT,
  ip TEXT,
  user_agent TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  certificate TEXT NOT NULL,                     -- HMAC-SHA256 over the canonical record
  confirm_token TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  withdrawn_how TEXT
);
CREATE INDEX IF NOT EXISTS lp_consents_person ON lp_consents (person_id, channel);
CREATE TABLE IF NOT EXISTS lp_events (
  id SERIAL PRIMARY KEY,
  person_id INT REFERENCES lp_persons(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  source TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lp_events_person ON lp_events (person_id, at DESC);
CREATE TABLE IF NOT EXISTS lp_deliveries (
  id SERIAL PRIMARY KEY,
  person_id INT NOT NULL REFERENCES lp_persons(id) ON DELETE CASCADE,
  client_id INT NOT NULL,
  consent_id INT REFERENCES lp_consents(id),
  exclusive BOOLEAN NOT NULL DEFAULT true,
  price NUMERIC(10,2),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lp_suppressions (
  id SERIAL PRIMARY KEY,
  value_hash TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',          -- global | client:<id> | channel:<name>
  reason TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (value_hash, scope)
);
CREATE TABLE IF NOT EXISTS lp_country_rules (
  country TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rules JSONB NOT NULL,
  cold_allowed BOOLEAN NOT NULL DEFAULT false,   -- no outreach without consent, even where the law allows opt-out
  reviewed_at DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lp_rule_log (
  id SERIAL PRIMARY KEY,
  person_id INT REFERENCES lp_persons(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  purpose TEXT NOT NULL,
  client_id INT,
  allowed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  consent_id INT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lp_rule_log_person ON lp_rule_log (person_id, at DESC);
CREATE TABLE IF NOT EXISTS lp_forms (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  client_id INT NOT NULL,
  title TEXT NOT NULL,
  intro TEXT,
  vertical TEXT NOT NULL,
  country TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  fields JSONB NOT NULL,
  channels TEXT[] NOT NULL DEFAULT '{email,whatsapp}',
  partners INT[] NOT NULL DEFAULT '{}',
  purpose TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lp_views (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

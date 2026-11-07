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

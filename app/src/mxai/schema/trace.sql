-- Layer 08 (observability): one row per AI answer, with what each layer decided. Phone numbers and emails are
-- redacted before they are written (trace.js). Rows go when their business is deleted.
CREATE TABLE IF NOT EXISTS ai_traces (
  id bigserial PRIMARY KEY,
  business_id int REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id int,
  audience text,
  role text,
  steps jsonb NOT NULL DEFAULT '[]',
  flags jsonb NOT NULL DEFAULT '[]',
  provider text,
  model text,
  ms int,
  outcome text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_traces_biz_at ON ai_traces (business_id, at DESC);

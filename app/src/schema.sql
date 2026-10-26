CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  open_hour INT DEFAULT 10,
  close_hour INT DEFAULT 20,
  closed_days INT[] DEFAULT '{0}',          -- 0 = Sunday
  faq TEXT DEFAULT '',
  currency TEXT DEFAULT 'USD',
  plan_price NUMERIC DEFAULT 79,
  wa_phone_number_id TEXT UNIQUE,           -- WhatsApp Cloud API phone number id
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  minutes INT NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, phone)
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp | missed_call | test
  outcome TEXT,                             -- answered | booked | handoff
  value NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                       -- customer | assistant
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INT REFERENCES customers(id),
  service_id INT REFERENCES services(id),
  conversation_id INT REFERENCES conversations(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  price NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'confirmed',          -- confirmed | cancelled | completed | no_show
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conv_biz_time ON conversations (business_id, created_at);
CREATE INDEX IF NOT EXISTS book_biz_time ON bookings (business_id, starts_at);

-- Availability: weekly hours per day (several ranges allow breaks), how many customers at once, slot step
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS hours JSONB;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS capacity INT DEFAULT 1;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS slot_step INT DEFAULT 30;
UPDATE businesses SET hours = (
  SELECT jsonb_object_agg(d::text, CASE WHEN d = ANY(closed_days) THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_array(lpad(open_hour::text,2,'0')||':00', lpad(close_hour::text,2,'0')||':00')) END)
  FROM generate_series(0,6) d) WHERE hours IS NULL;

CREATE TABLE IF NOT EXISTS time_off (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT DEFAULT ''
);

-- AI health and follow-up
ALTER TABLE messages ADD COLUMN IF NOT EXISTS latency_ms INT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS failed BOOLEAN DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attention_reason TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'ai';   -- ai | manual
UPDATE bookings SET source='manual' WHERE conversation_id IS NULL AND source='ai';

-- Meta can deliver the same webhook twice; each WhatsApp message id is handled once.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_id ON messages (wa_id) WHERE wa_id IS NOT NULL;
-- Removed services stay for old bookings but are hidden and never offered.
ALTER TABLE services ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Booking confirmations: what the customer is told after every booking
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_methods TEXT DEFAULT 'Cash, card or Apple Pay at the salon';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_note TEXT DEFAULT 'Please arrive 5 minutes early. Free cancellation up to 4 hours before.';
-- Extra requests (a specific stylist, a discount, bringing a child...) wait for the manager
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT;

-- Cancellation policy: customers can cancel/reschedule by chat until this many hours before; after that they must call.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cancel_hours INT DEFAULT 24;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
UPDATE businesses SET booking_note='Please arrive 5 minutes early.' WHERE booking_note='Please arrive 5 minutes early. Free cancellation up to 4 hours before.';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by TEXT;   -- customer | staff

-- Things the AI is not allowed to decide alone: late cancellations, late time changes, extra requests.
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
  conversation_id INT REFERENCES conversations(id) ON DELETE SET NULL,
  type TEXT NOT NULL,                       -- cancel | reschedule | extra
  details TEXT,
  new_start TIMESTAMPTZ,                    -- for reschedule
  status TEXT DEFAULT 'pending',            -- pending | approved | rejected
  staff_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS requests_pending ON requests (business_id) WHERE status = 'pending';

-- Discount codes the owner creates; the AI only passes the code, the app checks it.
CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'percent',     -- percent | amount
  value NUMERIC NOT NULL,
  expires_on DATE,
  max_uses INT,
  uses INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, code)
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS list_price NUMERIC;

-- Website booking: each booking gets a private link so the customer can view or cancel it.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS manage_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_manage_token ON bookings (manage_token) WHERE manage_token IS NOT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;

-- Reminders before appointments
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN DEFAULT true;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS reminder_hours INT DEFAULT 24;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS reminder_text TEXT DEFAULT 'Hi {name}, this is a reminder of your {service} at {business} tomorrow, {date} at {time} (ref {ref}). Reply here if you need to change anything. See you soon!';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_status TEXT;   -- sent | skipped | not_sent: <reason>

-- Online booking page is an optional add-on the business can switch on and customise
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT true;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_title TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_intro TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_color TEXT DEFAULT '#10a35a';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_show_prices BOOLEAN DEFAULT true;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_min_notice_hours INT DEFAULT 2;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_days_ahead INT DEFAULT 30;
ALTER TABLE businesses ALTER COLUMN reminder_text SET DEFAULT 'Hi {name}, a reminder of your {service} at {business} {when}, {date} at {time} (ref {ref}). Reply here if you need to change anything. See you soon!';
UPDATE businesses SET reminder_text = 'Hi {name}, a reminder of your {service} at {business} {when}, {date} at {time} (ref {ref}). Reply here if you need to change anything. See you soon!'
  WHERE reminder_text LIKE 'Hi {name}, this is a reminder of your {service} at {business} tomorrow,%';

-- Customer profiles: the AI recognises returning customers and remembers how they like to be reminded.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reminder_channel TEXT DEFAULT 'whatsapp';   -- whatsapp | sms | email
ALTER TABLE customers ADD COLUMN IF NOT EXISTS staff_notes TEXT;     -- private, written by staff (allergies, preferences…)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS language TEXT;        -- last language they wrote in
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_phone TEXT;   -- phone given in chat when the chat itself has no number

-- Richer business knowledge so the AI can answer more, and more accurately.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS website TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS instagram TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS maps_url TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS languages TEXT DEFAULT 'Arabic, English';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tone TEXT DEFAULT 'warm';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS assistant_name TEXT DEFAULT 'Nora';  -- the name the AI introduces itself with               -- warm | professional | playful
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS team TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS policies TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_instructions TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS faqs JSONB DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ask_email BOOLEAN DEFAULT true;
ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

-- Business type: changes wording, starter content and the AI's persona. The booking engine is the same.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS vertical TEXT DEFAULT 'salon';

-- Staff can take over a chat; while paused the AI doesn't reply in it.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN DEFAULT false;

-- Questions the AI couldn't answer. Staff answer once; the answer goes to the customer and into the FAQs.
CREATE TABLE IF NOT EXISTS learning (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id INT REFERENCES conversations(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  reason TEXT DEFAULT 'unknown',            -- unknown | ai_failed
  status TEXT DEFAULT 'open',               -- open | answered | dismissed
  answer TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  answered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS learning_open ON learning (business_id) WHERE status = 'open';

-- WeBook marketplace
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;     -- sample businesses for the marketplace, removable
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cover TEXT DEFAULT '';             -- CSS gradient or image URL for the profile header
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS listed BOOLEAN DEFAULT true;       -- show in WeBook discovery
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  booking_id INT REFERENCES bookings(id) ON DELETE SET NULL,
  stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text TEXT,
  author TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (booking_id)
);
-- Telegram chats: which Telegram chat belongs to which customer
ALTER TABLE customers ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telegram_token TEXT;   -- this business's own Telegram bot

-- Accounts: owners log in to their own business; role 'admin' (the platform owner) sees and manages every business.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',       -- owner | admin
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan_status TEXT DEFAULT 'trial';      -- trial | active | paused
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT now() + interval '14 days';

-- Teaching the AI: owners review replies, correct them, and set strict rules.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source TEXT;              -- ai | quick | fallback (assistant messages)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS confidence TEXT;          -- high | low, as judged by the AI itself
ALTER TABLE messages ADD COLUMN IF NOT EXISTS review TEXT;              -- approved | corrected | wrong
ALTER TABLE messages ADD COLUMN IF NOT EXISTS corrected_text TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS messages_review ON messages (conversation_id) WHERE role = 'assistant' AND review IS NULL;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_rules JSONB DEFAULT '[]';

-- Plans, add-ons and per-business switches (the command center edits these).
CREATE TABLE IF NOT EXISTS plans (key TEXT PRIMARY KEY, name TEXT NOT NULL, price NUMERIC DEFAULT 0, currency TEXT DEFAULT 'USD', features JSONB DEFAULT '[]', sort INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS addons (key TEXT PRIMARY KEY, name TEXT NOT NULL, price NUMERIC DEFAULT 0, currency TEXT DEFAULT 'USD', features JSONB DEFAULT '[]', sort INT DEFAULT 0);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan_key TEXT DEFAULT 'pro';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS addons JSONB DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS feature_overrides JSONB DEFAULT '{}';

-- Login security: staff permissions, two-factor, lockout, "sign out everywhere".
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB;             -- staff only: list of dashboard sections
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;
-- Two-factor by email: a 6-digit code mailed at each sign-in (stored only as a keyed hash, valid 10 minutes, 5 tries)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_2fa BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_exp TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_tries INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_sent TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Who did what, when, from where.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), user_id INT, user_email TEXT, business_id INT,
  action TEXT NOT NULL, detail TEXT, ip TEXT
);
CREATE INDEX IF NOT EXISTS audit_recent ON audit_log (at DESC);

-- Buffer time between bookings (business default, optional per service).
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS buffer_minutes INT DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS buffer_minutes INT;              -- NULL = use the business default

-- Payment options the AI may offer. Off until the business switches them on; "now" and "deposit" also need a payment provider.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pay_later BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pay_now BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pay_deposit BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;

-- Notification center: everything the business should know about, read or not.
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY, business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, conversation_id INT, booking_id INT,
  created_at TIMESTAMPTZ DEFAULT now(), read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notif_unread ON notifications (business_id, id DESC) WHERE read_at IS NULL;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS alert_kinds JSONB DEFAULT '["booking","cancel","approval","handoff","unsure"]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_telegram_chat TEXT;     -- owner's own Telegram chat for instant alerts
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_link_code TEXT;

-- Marketing: only clients who agreed get offers; STOP turns it off.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_ok BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY, business_id INT REFERENCES businesses(id) ON DELETE CASCADE, name TEXT, message TEXT NOT NULL,
  segment JSONB, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), sent INT DEFAULT 0, skipped INT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS campaign_sends (
  id BIGSERIAL PRIMARY KEY, campaign_id INT REFERENCES campaigns(id) ON DELETE CASCADE, customer_id INT, channel TEXT, status TEXT, at TIMESTAMPTZ DEFAULT now()
);

-- Pulse website: leads from the sign-up / demo form, and clicks on "Powered by Pulse" links
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY, kind TEXT DEFAULT 'signup', name TEXT, business TEXT, business_type TEXT, phone TEXT, email TEXT, country TEXT, message TEXT,
  ref_business_id INT REFERENCES businesses(id) ON DELETE SET NULL, source TEXT, ip TEXT, status TEXT DEFAULT 'new', notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ref_clicks (
  id BIGSERIAL PRIMARY KEY, business_id INT REFERENCES businesses(id) ON DELETE SET NULL, source TEXT, ip TEXT, at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ref_clicks_biz ON ref_clicks (business_id, at);

-- Restaurants: how many tables of each type, and how many guests a reservation is for
ALTER TABLE services ADD COLUMN IF NOT EXISTS capacity INT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS party_size INT;

-- Bot tokens are stored encrypted; the fingerprint finds duplicates without decrypting
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telegram_token_hash TEXT;
-- Photos and files uploaded by the business (served from /media/<business>/...)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS menu_url TEXT;

-- Client websites: settings (style, sections, languages, texts, gallery) and where the site lives
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS site JSONB;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subdomain TEXT UNIQUE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE;

-- Tap-to-answer choices sent with an assistant message (WhatsApp buttons/list, Telegram keyboard, web chips)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS options JSONB;

-- Uploaded photos and menus live in the database too, so a server whose disk is wiped (cloud hosting) keeps them.
CREATE TABLE IF NOT EXISTS media (business_id int NOT NULL, file text NOT NULL, mime text NOT NULL, data bytea NOT NULL, created_at timestamptz DEFAULT now(), PRIMARY KEY (business_id, file));


-- Messages the AI could not answer on the spot (rate limit, AI down): answered later, oldest first.
CREATE TABLE IF NOT EXISTS ai_queue (id serial PRIMARY KEY, conversation_id int NOT NULL, business_id int NOT NULL, channel text NOT NULL, phone text NOT NULL, name text,
  text text NOT NULL, status text NOT NULL DEFAULT 'waiting', attempts int NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), error text, created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS ai_queue_due ON ai_queue (status, next_at);


-- Customer satisfaction: asked once when a chat ends (booked, or thanks/bye), answered 1-5 with an optional comment.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rating int, ADD COLUMN IF NOT EXISTS rating_comment text, ADD COLUMN IF NOT EXISTS rating_asked_at timestamptz, ADD COLUMN IF NOT EXISTS rated_at timestamptz;
ALTER TABLE ai_queue ADD COLUMN IF NOT EXISTS answered_at timestamptz, ADD COLUMN IF NOT EXISTS reply text;


-- AI calls of the last minute, shared by every process, to stay under the AI plan's per-minute limit.
CREATE TABLE IF NOT EXISTS ai_calls (at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ai_calls_at ON ai_calls (at);


-- Receptionist + support: what each conversation is about, filled by the AI in the reply it already makes.
-- kind: booking | question | change | complaint | cancel | other. topic: a few words in English. mood: positive | neutral | negative.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS kind text, ADD COLUMN IF NOT EXISTS topic text, ADD COLUMN IF NOT EXISTS mood text;
CREATE INDEX IF NOT EXISTS conversations_kind ON conversations (business_id, kind);

-- Lessons the AI suggests from its own handovers and low ratings; nothing is used until the owner approves it.
CREATE TABLE IF NOT EXISTS ai_lessons (id serial PRIMARY KEY, business_id int NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title text NOT NULL, body text NOT NULL, source text, evidence int DEFAULT 1, status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz DEFAULT now(), decided_at timestamptz);
CREATE INDEX IF NOT EXISTS ai_lessons_biz ON ai_lessons (business_id, status);
-- A version is saved each time the owner approves lessons or changes rules; score comes from the latest test run.
CREATE TABLE IF NOT EXISTS ai_versions (id serial PRIMARY KEY, business_id int NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  note text, score int, created_at timestamptz DEFAULT now());
-- Test lab: simulated customers and the results of each run.
CREATE TABLE IF NOT EXISTS test_scenarios (id serial PRIMARY KEY, business_id int NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL, goal text NOT NULL, mood text DEFAULT 'neutral', language text DEFAULT 'English', opening text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS test_runs (id serial PRIMARY KEY, business_id int NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scenario_id int REFERENCES test_scenarios(id) ON DELETE CASCADE, version_id int, transcript jsonb, checks jsonb, score int, created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS test_runs_biz ON test_runs (business_id, created_at DESC);
-- conversations from before tagging: a booked chat is a booking
UPDATE conversations SET kind='booking' WHERE kind IS NULL AND outcome='booked';

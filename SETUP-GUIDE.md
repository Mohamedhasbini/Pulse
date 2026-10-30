# Pulse go-live guide

## 1. Free AI keys (about 10 minutes, no card needed)
Get each key, then send it to Claude in chat (or paste it into `.env`). Claude puts it in place and tests it.

| Provider | Steps | `.env` line |
|---|---|---|
| **Google Gemini** | 1. Open https://aistudio.google.com/apikey · 2. Sign in with your Google account · 3. **Create API key** → pick or create a project · 4. Copy the key (it starts with `AIza`) | `GEMINI_API_KEY=` |
| **Groq** | 1. Open https://console.groq.com · 2. Sign up with Google · 3. Left menu **API Keys** → **Create API Key**, name it "Pulse" · 4. Copy it now (shown once; starts with `gsk_`) | `GROQ_API_KEY=` |
| **OpenRouter** | 1. Open https://openrouter.ai · 2. **Sign in** with Google · 3. Menu → **Keys** → **Create Key**, name it "Pulse" · 4. Copy it (starts with `sk-or-`). Optional: a one-time $10 top-up raises the free daily limit a lot | `OPENROUTER_API_KEY=` |
| **Cerebras** (optional) | 1. Open https://cloud.cerebras.ai · 2. Sign up · 3. **API Keys** → create · 4. Copy it | `CEREBRAS_API_KEY=` |

Never post keys publicly. Use only one Google account; creating several to multiply the free quota breaks Google's terms.

## 2. Hosting (pick one)
| Option | Cost | Effort | Recommendation |
|---|---|---|---|
| **Hetzner VPS (CX22)** + Docker | ~€5 a month | Claude sets it up over SSH | **Best value**: the same Docker setup as your PC |
| Render (web service + Postgres) | ~$25 a month | Mostly clicks | Easier, more expensive; tried before and rolled back |
| Keep it on your PC | $0 | None | Only for testing: it goes offline when the PC sleeps |

What you do for Hetzner: sign up at https://www.hetzner.com/cloud, add a card, create a **CX22 Ubuntu** server, then send Claude the IP address. Also buy a domain (for example on Namecheap, about $10 a year).

## 3. WhatsApp Business (live number)
1. Get a phone number that is **not** on WhatsApp yet (a new SIM is fine).
2. Create a Meta Business account: https://business.facebook.com → Create account.
3. Easiest path: connect the number through **Kapso** (already wired into Pulse): https://kapso.ai → sign up → Connect WhatsApp → follow the Meta pop-up.
4. Meta business verification (company documents) raises the sending limits. It takes 1 to 5 days.
5. Send Claude the Kapso API key. Claude connects it and runs a live test.

## 4. Pilot with 3–5 salons
| Step | What |
|---|---|
| Pick salons | People you know, busy on WhatsApp, 1–3 staff |
| Offer | Free for 30 days, then a discounted founder price |
| Setup | Claude onboards each one with the new-client skill (services, hours, prices) in about 15 minutes |
| Measure | Bookings by the AI, reply time, no-shows, revenue won back. Pulse already tracks all of these |
| Week 4 | A short call for feedback and a testimonial |

# MXAi open-source stack — reference

Every open-source repo we install or build on is listed here: what it does, how MXAi uses it, its licence, where it runs and how to reach it.
**Rule:** whenever a repo is installed, upgraded or removed, this file is updated in the same change.

Last updated: 2026-11-07

## Where things run

- **MXAi v1** (`app/`, port 3100) does not use the engine services. **MXAi v2** (`v2/`, port 3200) reaches Crawl4AI, SearXNG and Reacher over the private Docker network `mxai-net`.

- **This PC** (Windows, Docker Desktop): 24 GB RAM (Docker limit ~12 GB), 24 CPU threads, ~570 GB free disk, AMD Radeon 890M (no NVIDIA GPU).
  - No NVIDIA GPU means open-source AI *video* models (LTX-Video, Wan, HunyuanVideo) cannot run here; they need a cloud GPU or a paid API.
  - CPU-friendly tools (voice, transcription, crawling, inbox, scheduling) run fine.
- **Install folder:** each tool lives in its own folder under `C:\Users\Mohamad\mxai-stack\<name>\` with its own `docker-compose.yml`, so it never interferes with the MXAi app's own `docker compose`.
- **Ports:** every tool gets a fixed local port, listed below. Nothing is exposed to the internet unless this file says so.

## Licence key

| Mark | Meaning for MXAi (a paid product) |
|---|---|
| Safe | MIT / Apache-2.0 / BSD: free to use inside the product |
| Care | AGPL / GPL: fine for internal use; if clients use a modified version over the network, our changes to *that tool* must be published. Keep it as a separate service, unmodified |
| Open core | Free edition plus paid "enterprise" features under a different licence |

## Installed

| Tool | Version | What it does | How MXAi uses it | Licence | Where / port | Installed | Status |
|---|---|---|---|---|---|---|---|
| pgvector | 0.8.7 | Search by meaning inside Postgres | v2: company and ideal-customer matching; v1: available, unused | Safe | Built into both database images (`db/Dockerfile`, `v2/db/Dockerfile`; Alpine kept so indexes and sorting are unchanged) | 2026-11-07 | Working in v1 and v2 |
| pg-boss | 12.38.1 | Job queue and scheduler in Postgres | Background runs of the growth engine (lead batches, business profiles) | Safe | npm library in **MXAi v2** (`v2/app`), schema `pgboss` in v2's database | 2026-11-07 | Working (runs every lead batch) |
| Vercel AI SDK (`ai`, `@ai-sdk/google`) + Zod | 7.0.164 / 4.0.113 / 4.6.7 | One API for AI models, validated answers, tool calls | The growth engine's AI gateway (`v2/app/src/engine/ai.js`) | Safe | npm libraries in **MXAi v2** | 2026-11-07 | Working |
| Crawl4AI | 0.9.5 | Reads websites into clean text | Prospector and Signal scout | Safe | `mxai-stack\crawl4ai`, http://127.0.0.1:11235 (needs `Authorization: Bearer <CRAWL4AI_API_TOKEN>` from its `.env`) | 2026-11-07 | Working (test crawl OK; refuses calls without the key) |
| SearXNG | 2026.11.6 | Private meta search engine | Finding company websites, news, mentions | Care (unmodified, separate service) | `mxai-stack\searxng`, http://127.0.0.1:8081 (`/search?q=…&format=json`) | 2026-11-07 | Working (36 results for a Dubai fit-out search) |
| Reacher | 0.11.11 | Checks if an email exists, without sending | Verifying lead emails | Safe | `mxai-stack\reacher`, http://127.0.0.1:8082 `/v0/check_email` (header `x-reacher-secret` from its `.env`); outbound port 25 is open on this PC | 2026-11-07 | Working |
| Lab worker: Splink + DuckDB + httpx (wappalyzergo) | 5.0.0 / 2.0.0 / 1.12.0 | Merging duplicate records; detecting a website's software | Clean company graph; tech signals | Safe | `mxai-stack\lab` (image `mxai-lab:1`), on demand: `docker compose --profile tools run --rm lab …` | 2026-11-07 | Working (tech detection and Splink import tested) |
| Promptfoo | 0.125.1 | Automatic tests for AI output | The quality bar for every worker | Safe | `mxai-stack\promptfoo` (`npm run eval`, results screen `npm run view` → port 15500) | 2026-11-07 | Installed |
| Ollama models | Ollama 0.40.13; `qwen3.5:4b`, `bge-m3` | Runs AI models on this PC | Free backup AI; free embeddings (1,024 numbers per text, Arabic works) | Safe | Windows app, http://127.0.0.1:11434; also already on this PC: `qwen3.5:9b`, `qwen3:8b`, `qwen3:30b-a3b`, `qwen2.5vl:7b`, `llama3.2` | 2026-11-07 | Working (Arabic embedding tested; 4B model's Arabic answers need the quality tests) |
| Uptime Kuma | 2.5.9 | Uptime checks, status page, alerts, backup heartbeats | Watching app, Lab, n8n, tunnel and backups | Safe | `mxai-stack\uptime-kuma`, http://127.0.0.1:3001 | 2026-11-07 | Running: **first visit asks you to create your own login**, then the checks are added |
| Beszel (hub + agent) | 0.21.1 | Memory, CPU, disk and container charts with alerts | Seeing when the PC runs short | Safe | `mxai-stack\beszel`, http://127.0.0.1:8090 | 2026-11-07 | Running: **create your login, then "Add system": host `agent`, port `45876`** (key already set) |
| Dozzle | 11.4.1 | Live logs of every container | Fast debugging | Safe | `mxai-stack\dozzle`, http://127.0.0.1:8085 | 2026-11-07 | Working |

Memory in use for all of the above: about 0.75 GB (Crawl4AI ~470 MB; each other service under 120 MB). Secrets (`.env` files in each `mxai-stack` folder) are never committed.

## Research of 7 Nov 2026: the full list

### Group 1 — engine core (installed 2026-11-07, see above)

| Tool | Repo | What it does | How MXAi uses it | Licence | Runs as | Memory |
|---|---|---|---|---|---|---|
| pgvector | [pgvector/pgvector](https://github.com/pgvector/pgvector) | Search by meaning inside Postgres | Similar-company matching, searching FAQs, chats and business knowledge | Safe | Database image swap (`pgvector/pgvector:pg16`), backup first | none extra |
| pg-boss | [timgit/pg-boss](https://github.com/timgit/pg-boss) | Job queue and scheduler inside Postgres | Runs every AI worker in the background with retries and schedules; nothing lost on restart | Safe | npm library in the app | none extra |
| Vercel AI SDK | [vercel/ai](https://github.com/vercel/ai) | One API for all AI models, typed and validated answers, tool calls | Cleaner AI gateway for the workers (Gemini first, backups) | Safe | npm library in the app | none extra |
| Crawl4AI | [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) | Reads websites into clean text and structured data | Prospector and Signal scout read company websites, team and career pages | Safe | Docker service | 2–4 GB |
| SearXNG | [searxng/searxng](https://github.com/searxng/searxng) | Private search engine (combines many search engines) | Finding company websites, news and mentions without a paid search API | Care (separate, unmodified) | Docker service | 0.3 GB |
| Splink + DuckDB | [moj-analytical-services/splink](https://github.com/moj-analytical-services/splink) | Merges duplicate records with probabilities | One clean record per company (Arabic spellings, LLC/FZE, trade names) | Safe | Python worker container | 0.5–1 GB |
| Reacher | [reacherhq/check-if-email-exists](https://github.com/reacherhq/check-if-email-exists) | Checks whether an email address exists without sending | Verifies every lead email before use | Safe | Docker service (needs outgoing port 25; likely blocked at home, then a ~€5 VPS) | 0.2 GB |
| wappalyzergo + httpx | [projectdiscovery/wappalyzergo](https://github.com/projectdiscovery/wappalyzergo), [httpx](https://github.com/projectdiscovery/httpx) | Detects the software a website uses | "Uses Shopify / no booking system" signals and filters | Safe | Inside the Python/Go worker | tiny |
| Promptfoo | [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | Automatic tests for AI output | The quality bar: every worker change runs against fixed test sets | Safe | Dev tool (npm) | none |
| Ollama + Qwen 3.5 4B + bge-m3 | [ollama/ollama](https://github.com/ollama/ollama) | Runs AI models on this PC | Free backup AI and free embeddings when Gemini's free quota runs out | Safe (model licences: Apache) | Windows app, outside Docker | 3–6 GB while in use |

### Group 2 — keep the PC healthy (installed 2026-11-07, see above)

| Tool | Repo | What it does | Licence | Memory |
|---|---|---|---|---|
| Uptime Kuma | [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma) | Checks app, Lab, n8n and tunnel from outside; status page; Telegram alerts; confirms backups ran | Safe | 0.1 GB |
| Beszel | [henrygd/beszel](https://github.com/henrygd/beszel) | Memory, disk and per-container charts with alerts | Safe | 0.06 GB |
| Dozzle | [amir20/dozzle](https://github.com/amir20/dozzle) | Live, searchable logs of every container in the browser | Safe | tiny |

### Group 3 — later, when that phase starts

| Tool | Repo | For | Licence |
|---|---|---|---|
| Docling + MarkItDown | [docling](https://github.com/docling-project/docling), [markitdown](https://github.com/microsoft/markitdown) | Reading client PDFs, Word files and price lists | Safe |
| PaddleOCR (Arabic) | [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Scanned Arabic documents | Safe |
| Presidio | [microsoft/presidio](https://github.com/microsoft/presidio) | Hides personal data before text goes to free Gemini | Safe |
| changedetection.io | [dgtlmoon/changedetection.io](https://github.com/dgtlmoon/changedetection.io) | Website, careers-page and tender-page change signals | Safe |
| GPT Researcher | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Deep research briefs on a company | Safe |
| Stagehand | [browserbase/stagehand](https://github.com/browserbase/stagehand) | AI-driven browser steps for research | Safe |
| faster-whisper + Arabic dialect model | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Transcribing voice notes and videos | Safe |
| Chatterbox TTS | [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) | AI voice incl. Arabic (needs a GPU for speed) | Safe |
| MoviePy + FFmpeg | [Zulko/moviepy](https://github.com/Zulko/moviepy), [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (reference) | Assembling faceless short videos | Safe |
| ComfyUI + Wan 2.2 | [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [Wan2.2](https://github.com/Wan-Video/Wan2.2) | AI video clips (rented cloud GPU, no NVIDIA here) | Care / Safe |
| Postiz | [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) | Scheduling posts to 30+ platforms | Care |
| Listmonk | [knadh/listmonk](https://github.com/knadh/listmonk) | Win-back and newsletters by email | Care |
| Umami | [umami-software/umami](https://github.com/umami-software/umami) | Website analytics for generated client sites | Safe |
| Restic + Backrest | [restic](https://github.com/restic/restic), [backrest](https://github.com/garethgeorge/backrest) | Encrypted, versioned backups with a web screen | Safe / Care |
| Langfuse | [langfuse/langfuse](https://github.com/langfuse/langfuse) | Tracing every AI step (heavy: 4–6 GB) | Open core |
| LiteLLM (pinned version only) | [BerriAI/litellm](https://github.com/BerriAI/litellm) | One AI gateway for app and n8n with budgets (its package was hijacked in Mar 2026: pin exact versions) | Open core |
| OpenSEO | [every-app/open-seo](https://github.com/every-app/open-seo) | SEO worker (needs a paid DataForSEO key) | Safe |
| DocuSeal | [docusealco/docuseal](https://github.com/docusealco/docuseal) | Signed client agreements | Care |

### Founder tools (your own use, desktop apps)

| Tool | Repo | What it does | Licence |
|---|---|---|---|
| OpenWhispr | [OpenWhispr/openwhispr](https://github.com/OpenWhispr/openwhispr) | Dictate into any app (Wispr Flow alternative) | Safe |
| Cap | [CapSoftware/Cap](https://github.com/CapSoftware/Cap) | Screen recordings for demos and support (Loom alternative) | Care |
| AppFlowy (optional) | [AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | Notes and docs (Notion alternative) | Care |

## Reviewed and skipped

| Tool | Why skipped |
|---|---|
| Open Higgsfield ([Anil-matcha/Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI)) | Mostly a front end for a paid API (Muapi.ai); advertises "no content filters" (brand risk). Use ComfyUI + Wan directly |
| Voice Studio (debpalash/VoiceStudio) | Star count looks inflated (~104k stars, 354 watchers); installs by piping a script from the internet; AGPL + paid tier. Not safe to run |
| Cal.com | Went closed-source on 15 Apr 2026; the open "cal.diy" lost Teams, Workflows and the API. MXAi already books appointments itself |
| OpenProject | Heavy (~4 GB), not needed |
| Chatwoot | Good, but duplicates MXAi's own inbox and channels; paid AI tier. Kept as a design reference |
| Firecrawl (self-hosted) | AGPL and its anti-bot layer isn't in the open version; Crawl4AI is better self-hosted |
| Dify, Flowise | Licence limits on multi-client use / enterprise folders; n8n already covers it |
| Twenty CRM | AGPL plus enterprise files; MXAi has its own client records |
| XTTS-v2, F5-TTS base, Habibi-TTS Gulf, Fish Speech | Voice models not licensed for commercial use (or only below a revenue cap) |
| HunyuanVideo | Licence excludes the EU, UK and South Korea |
| LLM Guard, Rebuff, Watchtower (original), instructor-js, GPTCache | Archived or abandoned |
| vLLM, Temporal, Trigger.dev, PostHog, Grafana stack, Postal, Novu, Lago, Kill Bill | Too heavy for one PC or not needed now |
| Baileys (unofficial WhatsApp) | Breaks Meta's terms; numbers get banned |

## Licence warning: n8n
n8n's "Sustainable Use" licence allows it only as a hidden back end. Clients must not see n8n or connect their own accounts through it. MXAi's current pattern (client channel credentials passing through n8n) is a grey zone: either ask license@n8n.io or keep client credentials inside `app/` only.

## How to install, start, stop, remove (any tool)

```
cd C:\Users\Mohamad\mxai-stack\<name>
docker compose up -d        # start
docker compose stop         # stop (keeps data)
docker compose down         # remove containers (data volumes kept)
```
Before removing a tool's data volume, check this file for what depends on it and take a backup.

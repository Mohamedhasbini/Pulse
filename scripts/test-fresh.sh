#!/usr/bin/env bash
# Runs every test suite on a throwaway stack with a fresh, empty database. Your real data is never touched.
#   bash scripts/test-fresh.sh            (stack name "mxci")
#   bash scripts/test-fresh.sh mywork     (another name, so several runs can go side by side)
#   KEEP=1 bash scripts/test-fresh.sh     (leave the stack running afterwards, to look at it)
# The throwaway app reads its own settings file (.env.ci, made here from .env.example) with fresh random secrets and
# every channel and AI switched off, so it can never poll, answer or send with your real WhatsApp, Telegram, email or AI.
# GitHub runs this same script on every push (.github/workflows/test.yml).
set -u
cd "$(dirname "$0")/.."
P="${1:-mxci}"
REAL="$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
case "$P" in ''|aireceptionist|"$REAL"|"${COMPOSE_PROJECT_NAME:-aireceptionist}")
  echo "Refusing: '$P' is the name of your real stack. Pick another name." >&2; exit 2 ;;
esac

rnd() { openssl rand -hex "$1" 2>/dev/null || node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }
# Every setting that could reach a real channel, AI, email or alert. They are left out and set to nothing below.
OFF='WA_ACCESS_TOKEN|WA_APP_SECRET|WA_VERIFY_TOKEN|TELEGRAM_BOT_TOKEN|KAPSO_API_KEY|KAPSO_WEBHOOK_SECRET|ALERT_BOT_TOKEN|ALERT_CHAT_ID|RESEND_API_KEY|EMAIL_FROM|ANTHROPIC_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|CEREBRAS_API_KEY|AI_PRIMARY|N8N_WEBHOOK_URL|COACH_WEBHOOK_URL|ASSISTANT_WEBHOOK_URL'
{
  grep -v -E "^(ADMIN_PASSWORD|DB_PASSWORD|DATA_KEY|SESSION_SECRET|$OFF)=" .env.example
  echo "ADMIN_PASSWORD=$(rnd 16)"
  echo "DB_PASSWORD=$(rnd 16)"
  echo "DATA_KEY=$(rnd 32)"
  echo "SESSION_SECRET=$(rnd 32)"
  for k in $(echo "$OFF" | tr '|' ' '); do case "$k" in N8N_WEBHOOK_URL|WA_VERIFY_TOKEN) ;; *) echo "$k=" ;; esac; done
  # AI calls fail at once (nothing listens on port 9), exactly like on GitHub where no n8n runs
  echo "N8N_WEBHOOK_URL=http://127.0.0.1:9/webhook/ringback"
  echo "WA_VERIFY_TOKEN=test-$(rnd 8)"
} > .env.ci

# Safety check: no secret from your real .env may appear in the test settings.
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue ;; esac
    v="${v%$'\r'}"
    if [ ${#v} -ge 12 ] && echo "$OFF|ADMIN_PASSWORD|DB_PASSWORD|DATA_KEY" | tr '|' '\n' | grep -qx "$k" && grep -qF -- "$v" .env.ci; then
      echo "Refusing: the test settings would contain your real $k." >&2; rm -f .env.ci; exit 2
    fi
  done < .env
fi
mkdir -p backups

DC="docker compose -p $P --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml"
cleanup() { [ "${KEEP:-0}" = 1 ] && echo "Stack '$P' left running (KEEP=1). Remove it with: $DC down -v" || $DC down -v --remove-orphans --rmi local >/dev/null 2>&1; }
trap cleanup EXIT

echo "Starting throwaway stack '$P' (fresh database)..."
if ! $DC up -d --build --wait db app >/dev/null; then
  echo "The throwaway stack did not start:" >&2; $DC logs app --tail 80 >&2; exit 1
fi
$DC exec -T app npm test; status=$?
if [ $status -ne 0 ]; then echo; echo "--- app log (last 120 lines) ---"; $DC logs app --tail 120; fi
exit $status

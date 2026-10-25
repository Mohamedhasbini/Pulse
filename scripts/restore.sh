#!/bin/sh
# Restore the database from a backup in ./backups. Everything since that backup is lost.
# Usage: sh scripts/restore.sh backups/ringback-2026-10-25_1200.sql.gz
set -e
f="$1"
[ -f "$f" ] || { echo "Backup file not found: $f"; ls backups/*.sql.gz 2>/dev/null; exit 1; }
printf "This replaces ALL current data with %s. Type RESTORE to continue: " "$f"; read ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
docker compose stop app
docker compose exec -T db psql -U ringback -d postgres -c "DROP DATABASE IF EXISTS ringback WITH (FORCE);" -c "CREATE DATABASE ringback OWNER ringback;"
gunzip -c "$f" | docker compose exec -T db psql -U ringback -d ringback -q
docker compose start app
echo "Restored from $f"

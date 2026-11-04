#!/bin/sh
# Restore the database from a backup in ./backups. Everything since that backup is replaced.
# Usage: sh scripts/restore.sh backups/ringback-2026-10-25_1200.sql.gz
# Safe by design:
#   1. the backup file is checked first (a cut-off or damaged file stops here, nothing touched)
#   2. today's data is saved as backups/pre-restore-<time>.sql.gz, so the restore itself can be undone
#   3. the backup is loaded into a separate database; only if every statement succeeds does it replace the live one
set -e
f="$1"
[ -f "$f" ] || { echo "Backup file not found: $f"; ls backups/*.sql.gz 2>/dev/null; exit 1; }
gunzip -t "$f" 2>/dev/null || { echo "That backup file is damaged or incomplete: $f. Nothing was changed."; exit 1; }
printf "This replaces ALL current data with %s. Type RESTORE to continue: " "$f"; read ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
ts=$(date +%Y-%m-%d_%H%M)
DB="docker compose exec -T db"
echo "Saving today's data first: backups/pre-restore-$ts.sql.gz"
$DB pg_dump -U ringback -d ringback --no-owner | gzip > "backups/pre-restore-$ts.sql.gz"
[ -s "backups/pre-restore-$ts.sql.gz" ] || { echo "Could not save today's data. Nothing was changed."; exit 1; }
echo "Loading the backup into a separate database..."
$DB psql -U ringback -d postgres -q -c "DROP DATABASE IF EXISTS ringback_restore;" -c "CREATE DATABASE ringback_restore OWNER ringback;"
if ! gunzip -c "$f" | $DB psql -U ringback -d ringback_restore -q -v ON_ERROR_STOP=1 --single-transaction >/dev/null; then
  $DB psql -U ringback -d postgres -q -c "DROP DATABASE IF EXISTS ringback_restore;"
  echo "The backup did not load cleanly. Your live data was NOT changed."; exit 1
fi
echo "Backup loaded. Switching it in (the app stops for a moment)..."
docker compose stop app
$DB psql -U ringback -d postgres -q -c "DROP DATABASE ringback WITH (FORCE);" -c "ALTER DATABASE ringback_restore RENAME TO ringback;"
docker compose start app
echo "Restored from $f. To undo: sh scripts/restore.sh backups/pre-restore-$ts.sql.gz"
echo "Photos and uploads are in backups/uploads-*.tar.gz (restore them by hand if needed)."

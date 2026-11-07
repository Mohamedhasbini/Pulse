# Proves the newest backup can really be restored: loads it into a throwaway database next to the live one,
# compares row counts with the live data, then drops the copy. The live database is only read.
# Run inside the backup container (it has the Postgres tools and the backups folder):
#   docker compose exec -T backup sh -s < scripts/restore-test.sh
# The result is appended to backups/restore-test.log (the Lab's Health check reads it).
set -u
f=$(ls -t /backups/ringback-*.sql.gz 2>/dev/null | head -1)
log=/backups/restore-test.log
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -z "$f" ]; then echo "$now FAIL no backup file found" >> $log; exit 1; fi
db=ringback_restore_test
P="psql -h db -U ringback -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null && $P -d postgres -c "CREATE DATABASE $db" >/dev/null || { echo "$now FAIL could not create the test database" >> $log; exit 1; }
if ! gunzip -c "$f" | $P -d $db >/dev/null 2>/tmp/restore.err; then
  echo "$now FAIL $(basename $f) did not restore: $(head -c 200 /tmp/restore.err | tr '\n' ' ')" >> $log
  $P -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null; exit 1
fi
out=""; bad=0
for t in businesses users customers bookings conversations messages; do
  r=$(psql -h db -U ringback -d $db -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo -1)
  l=$(psql -h db -U ringback -d ringback -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo -1)
  out="$out $t=$r/$l"
  # the backup is older than the live data, so it may have fewer rows, never none and never an error
  if [ "$r" -lt 0 ] || { [ "$t" = businesses ] && [ "$r" -lt 1 ]; }; then bad=1; fi
done
$P -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null
if [ $bad = 0 ]; then echo "$now ok $(basename $f) restored:$out (backup/live)" >> $log; else echo "$now FAIL $(basename $f) restored but tables are missing:$out" >> $log; exit 1; fi
tail -1 $log

#!/bin/sh
# Start (or update) Pulse on the server. Restores db.sql.gz once if present.
set -e
cd /opt/pulse && git pull -q
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build db
if [ -f db.sql.gz ]; then
  until docker compose exec -T db pg_isready -U ringback >/dev/null 2>&1; do sleep 2; done
  gunzip -c db.sql.gz | docker compose exec -T db psql -q -U ringback -d ringback && mv db.sql.gz db.sql.gz.restored
fi
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose ps

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
file="chess-$(date -u +'%Y%m%dT%H%M%SZ').sqlite"
docker compose --env-file .env exec -T chess node scripts/backup-db.js "/tmp/$file"
docker compose --env-file .env cp "chess:/tmp/$file" "backups/$file"
docker compose --env-file .env exec -T chess rm -f "/tmp/$file"
chmod 600 "backups/$file"
find backups -type f -name 'chess-*.sqlite' -mtime +14 -delete
printf 'Verified backup: %s\n' "backups/$file"

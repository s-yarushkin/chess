#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v python3 >/dev/null || { echo 'python3 required'; exit 1; }
command -v docker >/dev/null || { echo 'Docker required'; exit 1; }
docker compose version >/dev/null || { echo 'Docker Compose v2 required'; exit 1; }
APP_DOMAIN="$(python3 scripts/validate-deploy.py .env --domain)"
docker compose --env-file .env config --quiet
echo '=== Containers ==='
docker compose --env-file .env up -d --build
echo '=== Import 3,000 vetted puzzles ==='
docker compose --env-file .env exec -T chess node scripts/school-catalog.js --import
echo '=== External HTTPS readiness ==='
ready=0
for _ in $(seq 1 36); do
 if curl --fail --silent --max-time 6 "https://${APP_DOMAIN}/readyz" >/dev/null 2>&1; then ready=1; break; fi
 sleep 5
done
if [[ "$ready" -ne 1 ]]; then
 echo "HTTPS readiness failed. Check DNS, TCP 80/443 and docker compose logs caddy" >&2
 exit 1
fi
echo '=== Telegram setup ==='
docker compose --env-file .env exec -T chess node scripts/setup-bot.js
echo '=== Release health ==='
curl --fail --silent --show-error "https://${APP_DOMAIN}/readyz"
if [[ "$(pwd -P)" == /opt/chess && "$EUID" -eq 0 ]] && command -v systemctl >/dev/null; then
 cp deploy/chess-backup.service deploy/chess-backup.timer /etc/systemd/system/
 systemctl daemon-reload
 systemctl enable --now chess-backup.timer
 echo 'Backup timer enabled.'
else
 echo 'Backup timer not enabled (requires root and /opt/chess).'
fi
printf '\nPILOT READY: https://%s\nOnly allowlisted adult Telegram accounts can sign in.\n' "$APP_DOMAIN"

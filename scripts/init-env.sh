#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
if [[ -e .env ]]; then echo '.env exists; not overwriting'; exit 0; fi
cp .env.pilot.example .env
secret="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
sed -i "s/REPLACE_WITH_GENERATED_SECRET/$secret/" .env
chmod 600 .env
echo 'Created .env mode 600 with random webhook secret.'
echo 'Edit APP_DOMAIN, WEBAPP_URL, TG_BOT_TOKEN, PILOT_TELEGRAM_IDS.'

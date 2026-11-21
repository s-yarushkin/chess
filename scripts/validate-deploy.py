#!/usr/bin/env python3
"""Reject unsafe launch configuration without printing credentials."""
import argparse
import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlsplit

def load(path):
    result = {}
    for number, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise ValueError(f'Invalid environment file line {number}')
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in result:
            raise ValueError(f'Invalid or duplicate environment key on line {number}')
        result[key] = value
    return result

def validate(env, check_permissions=False, path=None):
    errors = []
    def fail(cond, msg):
        if not cond:
            errors.append(msg)
    domain = env.get('APP_DOMAIN', '')
    domain_ok = bool(re.fullmatch(r'(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})', domain))
    fail(domain_ok and not domain.endswith('.example.com'), 'APP_DOMAIN must be a real DNS host, not example.com')
    u = urlsplit(env.get('WEBAPP_URL', ''))
    fail(u.scheme == 'https' and u.netloc == domain and u.path in ('','/') and not u.query and not u.fragment, 'WEBAPP_URL must equal https://APP_DOMAIN')
    fail(bool(re.fullmatch(r'\d{6,12}:[A-Za-z0-9_-]{20,}', env.get('TG_BOT_TOKEN', ''))), 'TG_BOT_TOKEN missing or invalid')
    fail(bool(re.fullmatch(r'[A-Za-z0-9_-]{32,256}', env.get('TG_WEBHOOK_SECRET', ''))), 'TG_WEBHOOK_SECRET needs 32–256 safe characters')
    ids = [x.strip() for x in env.get('PILOT_TELEGRAM_IDS','').split(',')]
    fail(1 <= len(ids) <= 30 and all(re.fullmatch(r'[1-9]\d{4,15}', x) for x in ids) and len(set(ids)) == len(ids), 'PILOT_TELEGRAM_IDS must be 1–30 unique adult Telegram numeric IDs')
    fail(env.get('NODE_ENV') == 'production', 'NODE_ENV must be production')
    fail(env.get('DEV_MODE') == '0', 'DEV_MODE must be 0')
    fail(env.get('FRIENDS_ENABLED','0') == '0', 'FRIENDS_ENABLED must stay 0 until guardian controls exist')
    if check_permissions and os.name == 'posix' and path is not None:
        fail(not (stat.S_IMODE(path.stat().st_mode) & 0o077), 'chmod 600 .env required')
    return errors

def main():
    p = argparse.ArgumentParser()
    p.add_argument('file', nargs='?', default='.env')
    p.add_argument('--domain', action='store_true')
    a = p.parse_args()
    path = Path(a.file)
    if not path.exists():
        print('Missing .env: run bash scripts/init-env.sh', file=sys.stderr)
        return 2
    try:
        env = load(path)
        errors = validate(env, check_permissions=path.name=='.env', path=path)
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if errors:
        for error in errors: print('CONFIG ERROR: '+error, file=sys.stderr)
        return 2
    if a.domain:
        print(env['APP_DOMAIN'])
    else:
        print(f"Config OK: {env['APP_DOMAIN']}, {len(env['PILOT_TELEGRAM_IDS'].split(','))} adult testers, friends disabled. Secrets not printed.")
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

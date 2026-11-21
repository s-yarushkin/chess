#!/usr/bin/env bash
# New dedicated Ubuntu 22.04/24.04 host only.
set -euo pipefail
if [[ "$EUID" -ne 0 ]]; then echo 'Run as root' >&2; exit 1; fi
. /etc/os-release
if [[ "$ID" != ubuntu || ! "$VERSION_ID" =~ ^(22\.04|24\.04)$ ]]; then
  echo 'Only Ubuntu 22.04/24.04 supported' >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git python3
if docker compose version >/dev/null 2>&1; then
  echo 'Docker already installed; leaving it unchanged.'; exit 0
fi
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOT
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOT
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version
echo 'Docker installed. Firewall and reverse proxies untouched.'

#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
key_file="/etc/wow-dashboard/deploy-trigger.key"

install -d -o root -g wowdash -m 0750 /etc/wow-dashboard
install -o root -g root -m 0755 \
  "$script_dir/wow-dashboard-deploy-poll.py" \
  /usr/local/sbin/wow-dashboard-deploy-poll
install -o root -g root -m 0755 \
  "$script_dir/wow-dashboard-deploy" \
  /usr/local/sbin/wow-dashboard-deploy
install -o root -g root -m 0644 \
  "$script_dir/wow-dashboard-deploy-poll.service" \
  /etc/systemd/system/wow-dashboard-deploy-poll.service
install -o root -g root -m 0644 \
  "$script_dir/wow-dashboard-deploy-poll.timer" \
  /etc/systemd/system/wow-dashboard-deploy-poll.timer

if [[ ! -f "$key_file" ]]; then
  temporary_key="$(mktemp /etc/wow-dashboard/deploy-trigger.key.XXXXXX)"
  trap 'rm -f "$temporary_key"' EXIT
  openssl rand -hex 32 >"$temporary_key"
  install -o root -g root -m 0600 "$temporary_key" "$key_file"
  rm -f "$temporary_key"
  trap - EXIT
fi

systemctl daemon-reload
systemctl enable --now wow-dashboard-deploy-poll.timer

echo "Installed the Beeroot deployment poller without exposing the signing key."

#!/usr/bin/env bash
set -euo pipefail

backup_file="${1:-}"
if [[ -z "$backup_file" ]]; then
  echo "Usage: bash deploy/test-postgres-backup-restore.sh <backup.dump>" >&2
  exit 1
fi

if [[ ! -f "$backup_file" ]]; then
  echo "Backup file not found: $backup_file" >&2
  exit 1
fi

container="wow-dashboard-restore-test-$(date +%s)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d \
  --name "$container" \
  -e POSTGRES_DB=wowdash \
  -e POSTGRES_USER=wowdash \
  -e POSTGRES_PASSWORD=restore-test-password \
  postgres:16-alpine >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U wowdash -d wowdash >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" != "1" ]]; then
  echo "Temporary Postgres container did not become ready." >&2
  exit 1
fi

docker cp "$backup_file" "$container:/tmp/backup.dump"
docker exec "$container" pg_restore --no-owner --no-acl -U wowdash -d wowdash /tmp/backup.dump

docker exec "$container" psql -U wowdash -d wowdash -v ON_ERROR_STOP=1 -c "
select 'players' as table_name, count(*) from players
union all select 'characters', count(*) from characters
union all select 'snapshots', count(*) from snapshots
union all select 'character_daily_snapshots', count(*) from character_daily_snapshots
union all select 'mythic_plus_runs', count(*) from mythic_plus_runs;
"

echo "Restore test passed for $backup_file"

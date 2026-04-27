#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/wow-dashboard}"
ENV_FILE="${ENV_FILE:-}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"

cd "$APP_DIR"

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f deploy/.env.production ]]; then
    ENV_FILE="deploy/.env.production"
  elif [[ -f deploy/.env.staging ]]; then
    ENV_FILE="deploy/.env.staging"
    echo "Using legacy deploy/.env.staging. Rename it to deploy/.env.production after the production cutover."
  else
    ENV_FILE="deploy/.env.production"
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

compose_dir="$(dirname "$COMPOSE_FILE")"
env_dir="$(dirname "$ENV_FILE")"
if [[ -z "${SERVICE_ENV_FILE:-}" ]]; then
  if [[ "$env_dir" == "$compose_dir" ]]; then
    SERVICE_ENV_FILE="$(basename "$ENV_FILE")"
  else
    SERVICE_ENV_FILE="$ENV_FILE"
  fi
fi
export SERVICE_ENV_FILE

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U wowdash -d wowdash -v ON_ERROR_STOP=1 -c "VACUUM (ANALYZE);"

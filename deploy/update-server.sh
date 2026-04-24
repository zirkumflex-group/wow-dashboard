#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/wow-dashboard}"
ENV_FILE="${ENV_FILE:-deploy/.env.staging}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
DEPLOY_MARKER_NAME="wow-dashboard-last-successful-deploy"

build_services=(migrate api worker web)
up_services=(migrate api worker web caddy)

has_package_changes() {
  local base_rev="$1"
  local head_rev="$2"
  local changed_file

  while IFS= read -r changed_file; do
    case "$changed_file" in
      package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .dockerignore)
        return 0
        ;;
      apps/*/package.json | packages/*/package.json)
        return 0
        ;;
      deploy/Dockerfile.* | deploy/docker-compose.prod.yml)
        return 0
        ;;
    esac
  done < <(git diff --name-only "$base_rev" "$head_rev")

  return 1
}

cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

git_dir="$(git rev-parse --git-dir)"
deploy_marker="$git_dir/$DEPLOY_MARKER_NAME"
before_rev="$(git rev-parse HEAD)"
last_successful_rev=""

if [[ -f "$deploy_marker" ]]; then
  last_successful_rev="$(<"$deploy_marker")"
fi

git pull --ff-only

after_rev="$(git rev-parse HEAD)"
diff_base="$before_rev"
force_clean_build=0

if [[ -n "$last_successful_rev" ]]; then
  if git cat-file -e "$last_successful_rev^{commit}" 2>/dev/null; then
    diff_base="$last_successful_rev"
  else
    force_clean_build=1
  fi
else
  force_clean_build=1
fi

if [[ "$diff_base" != "$after_rev" ]] && has_package_changes "$diff_base" "$after_rev"; then
  force_clean_build=1
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
build_args=(--pull)

if [[ "$force_clean_build" == "1" ]]; then
  echo "Package or deploy metadata changed since the last successful deploy; building without Docker layer cache."
  build_args+=(--no-cache)
else
  echo "No package metadata changes detected; building with Docker layer cache."
fi

"${compose[@]}" build "${build_args[@]}" "${build_services[@]}"
"${compose[@]}" up -d --force-recreate --remove-orphans "${up_services[@]}"
"${compose[@]}" ps

printf "%s\n" "$after_rev" > "$deploy_marker"

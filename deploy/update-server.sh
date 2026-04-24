#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/wow-dashboard}"
ENV_FILE="${ENV_FILE:-deploy/.env.staging}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
DEPLOY_MARKER_NAME="wow-dashboard-last-successful-deploy"
PULL_BASE_IMAGES="${PULL_BASE_IMAGES:-auto}"
PULL_RETRIES="${PULL_RETRIES:-5}"
BUILD_RETRIES="${BUILD_RETRIES:-3}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-10}"

build_services=(migrate api worker web)
up_services=(migrate api worker web caddy)

retry_command() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2

  local attempt=1
  local exit_code=0

  while ((attempt <= attempts)); do
    if "$@"; then
      return 0
    fi

    exit_code="$?"
    if ((attempt == attempts)); then
      return "$exit_code"
    fi

    echo "Command failed with exit code $exit_code. Retrying in ${delay_seconds}s (${attempt}/${attempts})..."
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

pull_base_image() {
  local base_image="$1"

  if retry_command "$PULL_RETRIES" "$RETRY_DELAY_SECONDS" docker pull "$base_image"; then
    return 0
  fi

  if docker image inspect "$base_image" >/dev/null 2>&1; then
    echo "Could not refresh $base_image, but it exists locally; continuing with the cached image."
    return 0
  fi

  echo "Failed to pull missing base image: $base_image" >&2
  return 1
}

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

has_dockerfile_changes() {
  local base_rev="$1"
  local head_rev="$2"
  local changed_file

  while IFS= read -r changed_file; do
    case "$changed_file" in
      deploy/Dockerfile.*)
        return 0
        ;;
    esac
  done < <(git diff --name-only "$base_rev" "$head_rev")

  return 1
}

dockerfile_base_images() {
  local dockerfile
  local first_token
  local image
  local as_token
  local alias
  local -a images=()
  local -A aliases=()
  local -A emitted=()

  for dockerfile in deploy/Dockerfile.*; do
    while read -r first_token image as_token alias _; do
      first_token="${first_token%$'\r'}"
      image="${image%$'\r'}"
      as_token="${as_token%$'\r'}"
      alias="${alias%$'\r'}"

      [[ "$first_token" == "FROM" ]] || continue

      images+=("$image")

      if [[ "$as_token" == "AS" && -n "${alias:-}" ]]; then
        aliases["$alias"]=1
      fi
    done < "$dockerfile"
  done

  for image in "${images[@]}"; do
    [[ "$image" == \$* ]] && continue
    [[ -n "${aliases[$image]:-}" ]] && continue
    [[ -n "${emitted[$image]:-}" ]] && continue

    emitted["$image"]=1
    echo "$image"
  done
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
should_pull_base_images=0

if [[ -n "$last_successful_rev" ]]; then
  if git cat-file -e "$last_successful_rev^{commit}" 2>/dev/null; then
    diff_base="$last_successful_rev"
  else
    force_clean_build=1
    should_pull_base_images=1
  fi
else
  force_clean_build=1
  should_pull_base_images=1
fi

if [[ "$diff_base" != "$after_rev" ]] && has_package_changes "$diff_base" "$after_rev"; then
  force_clean_build=1
fi

if [[ "$diff_base" != "$after_rev" ]] && has_dockerfile_changes "$diff_base" "$after_rev"; then
  should_pull_base_images=1
fi

case "$PULL_BASE_IMAGES" in
  1 | true | yes)
    should_pull_base_images=1
    ;;
  0 | false | no)
    should_pull_base_images=0
    ;;
  auto)
    ;;
  *)
    echo "Invalid PULL_BASE_IMAGES value: $PULL_BASE_IMAGES. Use auto, 1, or 0." >&2
    exit 1
    ;;
esac

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
build_args=()

if [[ "$force_clean_build" == "1" ]]; then
  echo "Package or deploy metadata changed since the last successful deploy; building without Docker layer cache."
  build_args+=(--no-cache)
else
  echo "No package metadata changes detected; building with Docker layer cache."
fi

if [[ "$should_pull_base_images" == "1" ]]; then
  echo "Dockerfile/base-image changes detected; pulling base images with retries."
  while IFS= read -r base_image; do
    [[ -n "$base_image" ]] || continue
    pull_base_image "$base_image"
  done < <(dockerfile_base_images)
else
  echo "No Dockerfile/base-image changes detected; using locally cached base images when available."
fi

retry_command "$BUILD_RETRIES" "$RETRY_DELAY_SECONDS" "${compose[@]}" build "${build_args[@]}" "${build_services[@]}"
"${compose[@]}" up -d --force-recreate --remove-orphans "${up_services[@]}"
"${compose[@]}" ps

printf "%s\n" "$after_rev" > "$deploy_marker"

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/wow-dashboard}"
ENV_FILE="${ENV_FILE:-}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
DEPLOY_MARKER_NAME="wow-dashboard-last-successful-deploy"
PULL_BASE_IMAGES="${PULL_BASE_IMAGES:-auto}"
PULL_RETRIES="${PULL_RETRIES:-5}"
BUILD_RETRIES="${BUILD_RETRIES:-3}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-10}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
FORCE_FULL_DEPLOY="${FORCE_FULL_DEPLOY:-0}"
FORCE_CLEAN_BUILD="${FORCE_CLEAN_BUILD:-0}"

all_build_services=(migrate api worker web)
all_up_services=(migrate api worker web caddy)
build_services=("${all_build_services[@]}")
up_services=("${all_up_services[@]}")

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

has_full_deploy_metadata_changes() {
  local base_rev="$1"
  local head_rev="$2"
  local changed_file

  while IFS= read -r changed_file; do
    case "$changed_file" in
      package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .dockerignore)
        return 0
        ;;
      deploy/Dockerfile.* | deploy/docker-compose.prod.yml | deploy/update-server.sh)
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

select_deploy_services() {
  local base_rev="$1"
  local head_rev="$2"
  local force_full="$3"
  local changed_file
  local needs_full=0
  local needs_backend=0
  local needs_web=0
  local needs_caddy=0

  if [[ "$force_full" == "1" ]]; then
    build_services=("${all_build_services[@]}")
    up_services=("${all_up_services[@]}")
    echo "Deploying all services because a full deploy is required."
    return
  fi

  while IFS= read -r changed_file; do
    case "$changed_file" in
      package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .dockerignore)
        needs_full=1
        ;;
      deploy/Dockerfile.* | deploy/docker-compose.prod.yml | deploy/update-server.sh)
        needs_full=1
        ;;
      deploy/Caddyfile)
        needs_caddy=1
        ;;
      apps/api/* | apps/worker/* | packages/db/*)
        needs_backend=1
        ;;
      packages/api-schema/* | packages/env/*)
        needs_backend=1
        needs_web=1
        ;;
      apps/web/* | packages/api-client/* | packages/ui/*)
        needs_web=1
        ;;
    esac
  done < <(git diff --name-only "$base_rev" "$head_rev")

  if [[ "$needs_full" == "1" ]]; then
    build_services=("${all_build_services[@]}")
    up_services=("${all_up_services[@]}")
    echo "Deploying all services because package or deploy metadata changed."
    return
  fi

  build_services=()
  up_services=()

  if [[ "$needs_backend" == "1" ]]; then
    build_services+=(migrate api worker)
    up_services+=(migrate api worker)
  fi

  if [[ "$needs_web" == "1" ]]; then
    build_services+=(web)
    up_services+=(web)
  fi

  if [[ "$needs_caddy" == "1" ]]; then
    up_services+=(caddy)
  fi

  if [[ "${#build_services[@]}" == "0" ]]; then
    if [[ "${#up_services[@]}" != "0" ]]; then
      echo "Recreating changed services only: ${up_services[*]}"
      return
    fi

    build_services=("${all_build_services[@]}")
    up_services=("${all_up_services[@]}")
    echo "No deploy-specific file changes detected; running a full deploy."
    return
  fi

  echo "Deploying changed services only: ${up_services[*]}"
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

git_dir="$(git rev-parse --git-dir)"
deploy_marker="$git_dir/$DEPLOY_MARKER_NAME"
before_rev="$(git rev-parse HEAD)"
last_successful_rev=""

if [[ -f "$deploy_marker" ]]; then
  last_successful_rev="$(<"$deploy_marker")"
fi

case "$SKIP_GIT_PULL" in
  1 | true | yes)
    echo "Skipping git pull because SKIP_GIT_PULL=$SKIP_GIT_PULL."
    ;;
  0 | false | no)
    git pull --ff-only
    ;;
  *)
    echo "Invalid SKIP_GIT_PULL value: $SKIP_GIT_PULL. Use 1 or 0." >&2
    exit 1
    ;;
esac

after_rev="$(git rev-parse HEAD)"
diff_base="$before_rev"
force_clean_build=0
should_pull_base_images=0
force_full_deploy=0

if [[ -n "$last_successful_rev" ]]; then
  if git cat-file -e "$last_successful_rev^{commit}" 2>/dev/null; then
    diff_base="$last_successful_rev"
  else
    should_pull_base_images=1
    force_full_deploy=1
  fi
else
  should_pull_base_images=1
  force_full_deploy=1
fi

if [[ "$diff_base" != "$after_rev" ]] && has_full_deploy_metadata_changes "$diff_base" "$after_rev"; then
  force_full_deploy=1
fi

if [[ "$diff_base" != "$after_rev" ]] && has_dockerfile_changes "$diff_base" "$after_rev"; then
  should_pull_base_images=1
  force_full_deploy=1
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

case "$FORCE_FULL_DEPLOY" in
  1 | true | yes)
    force_full_deploy=1
    ;;
  0 | false | no)
    ;;
  *)
    echo "Invalid FORCE_FULL_DEPLOY value: $FORCE_FULL_DEPLOY. Use 1 or 0." >&2
    exit 1
    ;;
esac

case "$FORCE_CLEAN_BUILD" in
  1 | true | yes)
    force_clean_build=1
    ;;
  0 | false | no)
    ;;
  *)
    echo "Invalid FORCE_CLEAN_BUILD value: $FORCE_CLEAN_BUILD. Use 1 or 0." >&2
    exit 1
    ;;
esac

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
build_args=()

select_deploy_services "$diff_base" "$after_rev" "$force_full_deploy"

if [[ "$force_clean_build" == "1" ]]; then
  echo "FORCE_CLEAN_BUILD=$FORCE_CLEAN_BUILD; building without Docker layer cache."
  build_args+=(--no-cache)
else
  echo "Building with Docker layer cache; changed dependency metadata will invalidate only affected layers."
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

if (( ${#build_services[@]} > 0 )); then
  if ! retry_command "$BUILD_RETRIES" "$RETRY_DELAY_SECONDS" "${compose[@]}" build "${build_args[@]}" "${build_services[@]}"; then
    echo "Docker image build failed. Services were not recreated." >&2
    exit 1
  fi
else
  echo "No Docker image builds required."
fi

"${compose[@]}" up -d --force-recreate --remove-orphans "${up_services[@]}"
"${compose[@]}" ps

printf "%s\n" "$after_rev" > "$deploy_marker"

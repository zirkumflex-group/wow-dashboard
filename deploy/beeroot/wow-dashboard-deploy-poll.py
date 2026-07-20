#!/usr/bin/env python3
"""Validate signed GitHub deployment requests and deploy the current main revision."""

from __future__ import annotations

import fcntl
import hashlib
import hmac
import os
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
import sys


APP_DIR = Path(os.environ.get("WOW_DASHBOARD_APP_DIR", "/srv/wow-dashboard/app"))
APP_USER = os.environ.get("WOW_DASHBOARD_APP_USER", "wowdash")
DEPLOY_COMMAND = os.environ.get(
    "WOW_DASHBOARD_DEPLOY_COMMAND", "/usr/local/sbin/wow-dashboard-deploy"
)
KEY_FILE = Path(
    os.environ.get("WOW_DASHBOARD_DEPLOY_KEY_FILE", "/etc/wow-dashboard/deploy-trigger.key")
)
STATE_FILE = Path(
    os.environ.get(
        "WOW_DASHBOARD_DEPLOY_STATE_FILE",
        "/var/lib/wow-dashboard-deploy/last-request",
    )
)
LOCK_FILE = Path(
    os.environ.get(
        "WOW_DASHBOARD_DEPLOY_LOCK_FILE",
        "/run/lock/wow-dashboard-deploy-poll.lock",
    )
)
REPOSITORY = os.environ.get(
    "WOW_DASHBOARD_DEPLOY_REPOSITORY", "zirkumflex-group/wow-dashboard"
)
TAG_NAME = "production-deploy-request"
TAG_REF = f"refs/tags/{TAG_NAME}"
SHA_PATTERN = re.compile(r"^[a-f0-9]{40}$")
REQUEST_PATTERN = re.compile(
    r"^wow-dashboard-deploy-request:"
    r"(?P<version>v1):"
    r"(?P<repository>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+):"
    r"(?P<run_id>[1-9][0-9]*):"
    r"(?P<run_attempt>[1-9][0-9]*):"
    r"(?P<revision>[a-f0-9]{40}):"
    r"(?P<signature>[a-f0-9]{64})$"
)


@dataclass(frozen=True)
class DeploymentRequest:
    repository: str
    run_id: str
    run_attempt: str
    revision: str
    signature: str

    @property
    def payload(self) -> str:
        return f"v1:{self.repository}:{self.run_id}:{self.run_attempt}:{self.revision}"


def parse_tag_object(raw_tag: str) -> tuple[str, DeploymentRequest]:
    headers, separator, message = raw_tag.partition("\n\n")
    if not separator:
        raise ValueError("deployment request is not an annotated tag")

    header_values: dict[str, str] = {}
    for line in headers.splitlines():
        key, _, value = line.partition(" ")
        if key in {"object", "type", "tag"}:
            header_values[key] = value.strip()

    target_revision = header_values.get("object", "")
    if not SHA_PATTERN.fullmatch(target_revision):
        raise ValueError("deployment tag has an invalid target revision")
    if header_values.get("type") != "commit":
        raise ValueError("deployment tag does not target a commit")
    if header_values.get("tag") != TAG_NAME:
        raise ValueError("deployment tag has an unexpected name")

    match = REQUEST_PATTERN.fullmatch(message.strip())
    if not match:
        raise ValueError("deployment tag message is invalid")

    request = DeploymentRequest(
        repository=match.group("repository"),
        run_id=match.group("run_id"),
        run_attempt=match.group("run_attempt"),
        revision=match.group("revision"),
        signature=match.group("signature"),
    )
    if request.revision != target_revision:
        raise ValueError("deployment tag target does not match its signed revision")

    return target_revision, request


def calculate_signature(key: bytes, payload: str) -> str:
    return hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()


def verify_request(request: DeploymentRequest, key: bytes, repository: str) -> None:
    if len(key) != 32:
        raise ValueError("deployment key must contain exactly 32 bytes")
    if request.repository != repository:
        raise ValueError("deployment request targets an unexpected repository")

    expected = calculate_signature(key, request.payload)
    if not hmac.compare_digest(request.signature, expected):
        raise ValueError("deployment request signature is invalid")


def run_git(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    command = ["git", "-C", str(APP_DIR), *arguments]
    if os.geteuid() == 0 and APP_USER:
        command = ["runuser", "-u", APP_USER, "--", *command]

    return subprocess.run(
        command,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def write_state(tag_object: str) -> None:
    STATE_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary_file = STATE_FILE.with_suffix(".tmp")
    temporary_file.write_text(f"{tag_object}\n", encoding="utf-8")
    temporary_file.chmod(0o600)
    temporary_file.replace(STATE_FILE)


def read_state() -> str:
    try:
        return STATE_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""


def read_remote_tag_object() -> str | None:
    result = run_git("ls-remote", "--tags", "--refs", "origin", TAG_REF)
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return None
    if len(lines) != 1:
        raise RuntimeError("GitHub returned more than one production deployment request tag")

    tag_object, separator, ref_name = lines[0].partition("\t")
    if not separator or ref_name != TAG_REF or not SHA_PATTERN.fullmatch(tag_object):
        raise RuntimeError("GitHub returned an invalid production deployment request ref")
    return tag_object


def poll_once() -> None:
    remote_tag_object = read_remote_tag_object()
    if remote_tag_object is None or remote_tag_object == read_state():
        return

    run_git("fetch", "--force", "--no-tags", "origin", f"{TAG_REF}:{TAG_REF}")
    raw_tag = run_git("cat-file", "-p", remote_tag_object).stdout

    # Record each tag object before processing so a malformed or failed request
    # cannot create an uncontrolled deployment retry loop. Re-running the GitHub
    # workflow produces a new annotated tag object and therefore a new attempt.
    write_state(remote_tag_object)

    _, request = parse_tag_object(raw_tag)
    key_hex = KEY_FILE.read_text(encoding="utf-8").strip()
    try:
        key = bytes.fromhex(key_hex)
    except ValueError as error:
        raise ValueError("deployment key is not valid hex") from error
    verify_request(request, key, REPOSITORY)

    run_git(
        "fetch",
        "--prune",
        "origin",
        "+refs/heads/main:refs/remotes/origin/main",
    )
    ancestry = run_git(
        "merge-base",
        "--is-ancestor",
        request.revision,
        "refs/remotes/origin/main",
        check=False,
    )
    if ancestry.returncode != 0:
        raise ValueError("requested revision is not contained in origin/main")

    deploy_environment = os.environ.copy()
    deploy_environment["DEPLOY_REVISION"] = request.revision
    subprocess.run([DEPLOY_COMMAND], check=True, env=deploy_environment)

    deployed_revision = run_git("rev-parse", "HEAD").stdout.strip()
    if deployed_revision != request.revision:
        raise RuntimeError("production did not deploy the exact signed revision")

    print(
        f"Deployed {deployed_revision} for GitHub Actions run "
        f"{request.run_id} attempt {request.run_attempt}."
    )


def main() -> int:
    LOCK_FILE.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    with LOCK_FILE.open("w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0

        try:
            poll_once()
        except Exception as error:
            print(f"WoW Dashboard deployment request failed: {error}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

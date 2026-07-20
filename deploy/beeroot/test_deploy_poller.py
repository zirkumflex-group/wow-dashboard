from __future__ import annotations

import hashlib
import hmac
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).with_name("wow-dashboard-deploy-poll.py")
SPEC = importlib.util.spec_from_file_location("wow_dashboard_deploy_poll", MODULE_PATH)
assert SPEC and SPEC.loader
deploy_poll = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = deploy_poll
SPEC.loader.exec_module(deploy_poll)


class DeploymentRequestVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = bytes(range(32))
        self.repository = "zirkumflex-group/wow-dashboard"
        self.revision = "a" * 40
        self.payload = f"v1:{self.repository}:12345:2:{self.revision}"
        self.signature = hmac.new(
            self.key,
            self.payload.encode(),
            hashlib.sha256,
        ).hexdigest()

    def create_tag(self, *, target: str | None = None, signature: str | None = None) -> str:
        resolved_target = target or self.revision
        resolved_signature = signature or self.signature
        return (
            f"object {resolved_target}\n"
            "type commit\n"
            "tag production-deploy-request\n"
            "tagger github-actions[bot] <github-actions[bot]@users.noreply.github.com> 0 +0000\n"
            "\n"
            "wow-dashboard-deploy-request:"
            f"{self.payload}:{resolved_signature}\n"
        )

    def test_accepts_a_matching_signed_request(self) -> None:
        target, request = deploy_poll.parse_tag_object(self.create_tag())

        self.assertEqual(target, self.revision)
        deploy_poll.verify_request(request, self.key, self.repository)

    def test_rejects_a_tampered_signature(self) -> None:
        _, request = deploy_poll.parse_tag_object(self.create_tag(signature="0" * 64))

        with self.assertRaisesRegex(ValueError, "signature is invalid"):
            deploy_poll.verify_request(request, self.key, self.repository)

    def test_rejects_a_tag_whose_target_differs_from_the_signed_revision(self) -> None:
        with self.assertRaisesRegex(ValueError, "target does not match"):
            deploy_poll.parse_tag_object(self.create_tag(target="b" * 40))

    def test_rejects_a_request_for_another_repository(self) -> None:
        _, request = deploy_poll.parse_tag_object(self.create_tag())

        with self.assertRaisesRegex(ValueError, "unexpected repository"):
            deploy_poll.verify_request(request, self.key, "another/repository")

    def test_rejects_a_lightweight_or_malformed_tag(self) -> None:
        with self.assertRaisesRegex(ValueError, "annotated tag"):
            deploy_poll.parse_tag_object("not an annotated tag")

    def test_poller_deploys_the_exact_signed_revision(self) -> None:
        tag_object = "f" * 40
        git_results = [
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0, stdout=self.create_tag()),
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0, stdout=f"{self.revision}\n"),
        ]

        with tempfile.TemporaryDirectory() as temporary_directory:
            key_file = Path(temporary_directory, "deploy-trigger.key")
            key_file.write_text(self.key.hex(), encoding="utf-8")

            with (
                mock.patch.object(deploy_poll, "KEY_FILE", key_file),
                mock.patch.object(
                    deploy_poll,
                    "read_remote_tag_object",
                    return_value=tag_object,
                ),
                mock.patch.object(deploy_poll, "read_state", return_value=""),
                mock.patch.object(deploy_poll, "write_state") as write_state,
                mock.patch.object(deploy_poll, "run_git", side_effect=git_results),
                mock.patch.object(deploy_poll.subprocess, "run") as deploy,
            ):
                deploy_poll.poll_once()

        write_state.assert_called_once_with(tag_object)
        deploy.assert_called_once()
        self.assertEqual(
            deploy.call_args.kwargs["env"]["DEPLOY_REVISION"],
            self.revision,
        )


if __name__ == "__main__":
    unittest.main()

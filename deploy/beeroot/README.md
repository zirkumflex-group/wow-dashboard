# Beeroot GitHub Deployment Bridge

Beeroot does not expose SSH to the public internet, and this repository is public. Attaching a
general-purpose self-hosted GitHub runner to the production host would allow untrusted workflow code
to run on the server. The production workflow therefore uses a narrow outbound-only bridge:

1. GitHub-hosted CI verifies the requested `main` revision.
2. The protected `production` job writes an HMAC-signed annotated tag named
   `production-deploy-request`.
3. Beeroot polls that single tag, verifies the repository, revision, run identity, and signature,
   confirms the requested commit belongs to `origin/main`, and refuses a non-fast-forward checkout.
4. Beeroot runs the versioned `/usr/local/sbin/wow-dashboard-deploy` control plane once for that
   exact revision.
5. GitHub waits until the public readiness endpoint reports the exact revision CI verified.

The bridge never accepts inbound connections and cannot be triggered by merely forging or moving
the public tag because the signing key is stored only in the GitHub `production` environment and in
Beeroot's root-only `/etc/wow-dashboard/deploy-trigger.key`.

## Installation

From a trusted checkout on Beeroot:

```bash
sudo bash deploy/beeroot/install-deploy-poller.sh
sudo cat /etc/wow-dashboard/deploy-trigger.key | \
  gh secret set PRODUCTION_DEPLOY_HMAC_KEY --env production
```

The pipeline consumes no production SSH secrets. Existing `PRODUCTION_SSH_*` secrets can remain
unused until they are deliberately removed.

Verify the installation:

```bash
sudo systemctl status wow-dashboard-deploy-poll.timer --no-pager
sudo systemctl start wow-dashboard-deploy-poll.service
sudo journalctl -u wow-dashboard-deploy-poll.service -n 50 --no-pager
```

Re-running the installer updates the poller, deployment helper, and units without rotating the
existing signing key.
The service records each annotated tag object before attempting it, so a failed deployment is not
retried every 30 seconds. Re-running the GitHub workflow creates a new signed tag object and a fresh
single attempt.

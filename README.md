# WoW Dashboard

WoW Dashboard is a public World of Warcraft character dashboard for tracking characters, addon
snapshots, Mythic+ activity, and Battle.net character data.

The project includes a Windows desktop app, an in-game WoW addon, and the public web dashboard at
[wow.zirkumflex.io](https://wow.zirkumflex.io).

## Features

- Battle.net sign-in for player ownership and character sync
- Desktop app that reads the WoW addon SavedVariables file and uploads new activity
- In-game addon that records character snapshots and Mythic+ runs
- Public character pages, player rosters, and scoreboards
- Per-character visibility controls:
  - `Public`: visible in lists and shareable by normal character link
  - `Unlisted`: hidden from public lists but accessible by direct link
  - `Private`: visible only to the character owner
- Automatic desktop app and addon update checks

## Install

WoW Dashboard is currently distributed as a Windows app.

1. Open the [GitHub Releases page](https://github.com/zirkumflex-group/wow-dashboard/releases).
2. Find the latest `App v...` release.
3. Download `wow-dashboard.exe`.
4. Run `wow-dashboard.exe` and complete the installer.
5. Launch **WoW Dashboard**.
6. Sign in with Battle.net.
7. Select your World of Warcraft `_retail_` folder.
8. Click **Install Addon** in the desktop app.
9. Start or reload World of Warcraft and make sure **WoW Dashboard** is enabled in the addon list.
10. Play normally and enjoy.

The `_retail_` folder is usually inside your World of Warcraft install, for example:

```text
C:\Program Files (x86)\World of Warcraft\_retail_
```

## Using The Addon

The addon stores local snapshots in WoW's SavedVariables file. The desktop app watches that file and
uploads new snapshots and Mythic+ runs to your account.

Useful in-game commands:

```text
/wowdashboard
/wd
```

If no data appears after installing the addon, log into a character, wait for the addon to save a
snapshot, then return to the desktop app and click **Sync Now**.

## Web Dashboard

Open [wow.zirkumflex.io](https://wow.zirkumflex.io) to view synced characters, player rosters, and
scoreboards.

Characters are public by default. Character owners can change visibility from the character page:

- `Public` characters appear in public lists and scoreboards.
- `Unlisted` characters do not appear in public lists, but direct links work.
- `Private` characters are only visible while signed in as the owner.

## Updates

The desktop app checks GitHub releases for new app versions. When an update is downloaded, use
**Install update & restart** or fully quit the app from its tray menu so the update can be installed.

The desktop app also checks for addon releases and can install or update the WoW addon after your
`_retail_` folder is selected.

Windows release signing uses the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` repository secrets. When
both are configured, the release workflow requires a valid Authenticode signature before publishing.

## Development

Local development requires Node.js 24, pnpm 10 (the exact version is declared in `package.json`),
and Docker Desktop or Docker Engine with Compose. Lua 5.4 is also required for addon lint and tests.

On PowerShell 7 for Windows:

```powershell
Copy-Item .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts local Postgres and Redis, waits for them to become healthy, applies migrations,
then starts the API, worker, web app, and Electron client. Stop the foreground processes with
Ctrl+C. If local containers remain running, stop them with:

```powershell
pnpm dev:stop
```

Useful checks:

```powershell
pnpm check
pnpm -F @wow-dashboard/addon test
pnpm -F app test
```

The DB-backed API suite requires a disposable database whose name ends in `_test`; see
[`apps/api/README.md`](apps/api/README.md). CI runs the broader `pnpm verify` command with Postgres
and Redis test services.

Repository documentation:

- [`AGENTS.md`](AGENTS.md): architecture, safety invariants, and verification expectations
- [`apps/api/README.md`](apps/api/README.md): local OAuth and API test setup
- [`packages/db/README.md`](packages/db/README.md): schema and migration workflow
- [`deploy/README.md`](deploy/README.md): active production operations

Pull requests and pushes to `main` run the reusable verification workflow. Changes to the desktop
or addon release surfaces can also trigger release automation after they reach `main`. Production
deployment is manual-only while the server is being replaced; pushing to `main` does not deploy
the VPS.

## Troubleshooting

- **The app says the WoW folder is invalid:** choose the folder that ends with `_retail_`.
- **The addon is not detected:** install it from the desktop app, then restart WoW or run `/reload`.
- **No snapshots are pending:** log into a character with the addon enabled, then wait for a snapshot
  or save one from the addon UI.
- **Sync fails after login:** sign out and sign in again with Battle.net, then retry **Sync Now**.

## Project Links

- Public dashboard: [wow.zirkumflex.io](https://wow.zirkumflex.io)
- Releases: [github.com/zirkumflex-group/wow-dashboard/releases](https://github.com/zirkumflex-group/wow-dashboard/releases)

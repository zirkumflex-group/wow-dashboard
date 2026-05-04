# WoW Dashboard Tauri Desktop App

This app is the Tauri v2 rewrite of the Windows desktop uploader. The existing Electron app in
`apps/app` remains intact while the migration is validated.

## Architecture

- React, Vite, TypeScript, and Tailwind render the desktop UI.
- The renderer does not receive the bearer token. It calls typed Tauri commands and listens for
  desktop events from `src/lib/desktop.ts`.
- Rust owns trusted desktop behavior:
  - Battle.net hosted login callback handling and OS credential storage.
  - Authenticated API requests to the configured API origin.
  - `_retail_` folder validation and SavedVariables discovery.
  - Selective `WowDashboardDB` parsing, snapshot and Mythic+ run dedupe, and bounded upload
    batching.
  - Addon release checks, SHA-256 verification, safe ZIP extraction, install, and reinstall.
  - SavedVariables file watching, debounced sync, tray menu, autostart, deep links, and updater
    integration.
- Session tokens are stored through the OS credential manager via the Rust `keyring` crate. They are
  not written to JSON settings and are not exposed through renderer APIs.

## Environment

The app preserves the Electron environment names:

- `VITE_API_URL`: active WoW Dashboard API base URL, for example
  `https://wow.zirkumflex.io/api`.
- `VITE_SITE_URL`: hosted web login/dashboard URL, for example
  `https://wow.zirkumflex.io`.

Both values are build-time configuration for the renderer and Rust side. Local development defaults
to `http://localhost:3000/api` and `http://localhost:3001` if they are not set. Do not hard-code
production URLs in source.

## Commands

From the repository root:

```powershell
pnpm --filter app-tauri dev
pnpm --filter app-tauri build
pnpm --filter app-tauri check-types
pnpm --filter app-tauri cargo:check
pnpm --filter app-tauri cargo:test
```

## Windows Installer

The Windows package target is Tauri NSIS for `x86_64-pc-windows-msvc`, with a per-user install by
default and WebView2 handled by Tauri's download bootstrapper.

Replace the updater public key described below, then build the installer from the repository root:

```powershell
$env:VITE_API_URL = "https://wow.zirkumflex.io/api"
$env:VITE_SITE_URL = "https://wow.zirkumflex.io"
$env:TAURI_SIGNING_PRIVATE_KEY = "<tauri-updater-private-key>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<private-key-password-if-used>"
pnpm --filter app-tauri package
```

The NSIS artifact is written under:

```text
apps/app-tauri/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

Tauri's default installer file name includes the product name and version. CI can preserve the
existing Electron distribution name with:

```powershell
Get-ChildItem apps/app-tauri/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis -Filter "*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  Rename-Item -NewName "wow-dashboard.exe"
```

## Updater Signing

`src-tauri/tauri.conf.json` contains the public Tauri updater key used to verify release artifacts.
Do not rotate it unless you are prepared to update every installed app through a build signed by the
old key first.

Generate the updater key pair with the Tauri CLI:

```powershell
pnpm --filter app-tauri exec tauri signer generate -w .tauri/wow-dashboard-updater.key
```

Use the printed public key as `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Store the
private key as a CI secret named `TAURI_SIGNING_PRIVATE_KEY`. If a password is used, store it in
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The updater endpoint is:

```text
https://github.com/zirkumflex-group/wow-dashboard/releases/latest/download/latest.json
```

The GitHub release must upload a Tauri `latest.json` asset that points at the Tauri NSIS installer,
not the old Electron installer. For the Windows x64 app, use the `windows-x86_64` platform key
unless the release manifest intentionally separates installer types.

The repository release workflow builds `app-tauri`, renames the NSIS installer to
`wow-dashboard.exe`, uploads `wow-dashboard.exe`, `wow-dashboard.exe.sig`, and `latest.json`, and
marks that app release as the latest GitHub release.

## Electron Migration Bridge

Old Electron clients update through `latest.yml`, not Tauri's `latest.json`. During the migration,
the app release uploads both formats:

- `latest.yml` points old Electron installs to `wow-dashboard-electron-bridge.exe`.
- `latest.json` points Tauri installs to `wow-dashboard.exe`.

The Electron bridge uses the existing desktop bearer token only to request a short-lived
`/auth/login-code`, downloads the Tauri installer from the signed `latest.json` release metadata,
verifies the extra SHA-256 value in that metadata, runs the Tauri NSIS installer, then opens
`wow-dashboard://auth?code=...` so Tauri stores the new desktop session in the OS credential store.
It does not copy Electron's encrypted token file.

Tauri imports non-secret Electron settings on first run from `%APPDATA%\WoW Dashboard`:

- selected `_retail_` path
- close-to-tray
- Windows autostart
- launch minimized
- last sync timestamp

## Known Gaps

- The first Tauri app release must become the latest GitHub release before installed Tauri builds can
  resolve `latest.json` from the `releases/latest` endpoint.
- The SavedVariables parser is intentionally selective for the current `WowDashboardDB` subset. It is
  not a general-purpose Lua interpreter.
- This branch was validated with compile, unit, and frontend build checks. Full Windows NSIS bundling
  should be run on a Windows CI/packaging machine with the release signing key available.

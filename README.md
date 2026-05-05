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

The desktop app checks GitHub releases for new app versions. When an update is downloaded, install it
from the update prompt or close/reopen the app when prompted.

The desktop app also checks for addon releases and can install or update the WoW addon after your
`_retail_` folder is selected.

## Troubleshooting

- **The app says the WoW folder is invalid:** choose the folder that ends with `_retail_`.
- **The addon is not detected:** install it from the desktop app, then restart WoW or run `/reload`.
- **No snapshots are pending:** log into a character with the addon enabled, then wait for a snapshot
  or save one from the addon UI.
- **Sync fails after login:** sign out and sign in again with Battle.net, then retry **Sync Now**.

## Project Links

- Public dashboard: [wow.zirkumflex.io](https://wow.zirkumflex.io)
- Releases: [github.com/zirkumflex-group/wow-dashboard/releases](https://github.com/zirkumflex-group/wow-dashboard/releases)

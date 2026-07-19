# Dither Kit integration

These chart primitives were installed as source from
[Boring-Software-Inc/dither-kit](https://github.com/Boring-Software-Inc/dither-kit), pinned to
commit `1e7faee9aa252e499651e6736ed65f7a07d9a6bd`.

The upstream Dither CLI could not run in this Windows workspace because its child process expected
a globally resolvable `npx`. The same documented shadcn registry entries were therefore installed
with:

```powershell
pnpm dlx shadcn@latest add `
  "Boring-Software-Inc/dither-kit/area-chart#1e7faee9aa252e499651e6736ed65f7a07d9a6bd" `
  "Boring-Software-Inc/dither-kit/radar-chart#1e7faee9aa252e499651e6736ed65f7a07d9a6bd" `
  --yes
```

The upstream package manifest identifies the project as MIT licensed. At the pinned commit the
repository did not expose a standalone license file, so verify that status again before a future
major update or redistribution outside this application.

## Local adaptations

- Explicit Y-axis domains for progression metrics.
- Optional sparkles and bloom layers to control GPU/canvas cost.
- Reduced-motion-safe transitions and CSS-only tooltips (no Motion dependency).
- Accessible chart labels with decorative canvases hidden from assistive technology.
- Render loops sleep when the chart is stable and stop outside a 200px viewport margin.
- Character charts disable replay animation during periodic data refreshes.

## Updating

Pin a reviewed upstream commit rather than tracking the default branch. Run the shadcn command with
`--dry-run` first, compare every generated file against these adaptations, then run the web type,
lint, build, and browser checks. Do not overwrite this directory with an unreviewed registry update.

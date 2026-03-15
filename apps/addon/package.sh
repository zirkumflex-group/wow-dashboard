#!/usr/bin/env bash
# Packages the wow-dashboard addon into dist/wow-dashboard/
# Usage: bash apps/addon/package.sh
# Run from the repo root or from apps/addon/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADDON_NAME="wow-dashboard"
OUT_DIR="$SCRIPT_DIR/dist/$ADDON_NAME"

echo "Packaging $ADDON_NAME → $OUT_DIR"

# Clean previous build
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Copy addon files
cp "$SCRIPT_DIR/$ADDON_NAME.toc" "$OUT_DIR/$ADDON_NAME.toc"
cp "$SCRIPT_DIR/$ADDON_NAME.lua" "$OUT_DIR/$ADDON_NAME.lua"

# Copy asset directories (if they exist)
for dir in Art Fonts; do
    if [ -d "$SCRIPT_DIR/$dir" ]; then
        cp -r "$SCRIPT_DIR/$dir" "$OUT_DIR/$dir"
    fi
done

echo "Done! Addon packaged to: $OUT_DIR"
echo ""
echo "To install: copy the '$ADDON_NAME' folder into your WoW AddOns directory:"
echo "  <WoW>/_retail_/Interface/AddOns/$ADDON_NAME/"

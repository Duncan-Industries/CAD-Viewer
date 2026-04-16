#!/usr/bin/env bash
# Build the Python backend into a standalone binary with PyInstaller.
# Output: backend/dist/cadviewer-api  (or cadviewer-api.exe on Windows)
#
# Usage:
#   ./scripts/build-python.sh
#
# Prerequisites:
#   cd backend && pip install -r requirements.txt pyinstaller

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
DIST_DIR="$BACKEND_DIR/dist"

echo "==> Building Python backend with PyInstaller..."
cd "$BACKEND_DIR"

# Ensure pyinstaller is available
if ! command -v pyinstaller &>/dev/null; then
  echo "   Installing PyInstaller..."
  pip install pyinstaller
fi

pyinstaller cadviewer-api.spec \
  --distpath "$DIST_DIR" \
  --workpath "$BACKEND_DIR/build" \
  --noconfirm \
  --clean

echo ""
echo "==> Done. Binary: $DIST_DIR/cadviewer-api"
echo "    Size: $(du -sh "$DIST_DIR/cadviewer-api" 2>/dev/null | cut -f1)"

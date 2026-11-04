#!/usr/bin/env bash
# Package the focus-flow Executa as an Anna binary distribution archive.
# Adapted from the official forum tutorial #140 (PyInstaller onefile +
# bin/<tool_id> + manifest.json layout). Native platform only —
# cross-platform builds happen in CI or Docker.
set -euo pipefail

cd "$(dirname "$0")"

EXECUTA_JSON="executa.json"
ENTRY_FILE="focus_flow_plugin.py"
OUT_DIR="dist-anna"

if [ ! -f "$EXECUTA_JSON" ] || [ ! -f "$ENTRY_FILE" ]; then
  echo "ERROR: $EXECUTA_JSON / $ENTRY_FILE not found" >&2
  exit 1
fi

# Prefer the platform-minted tool_id from the publish identity cache
# (.anna/executa.json, written by `apps publish`); fall back to the dev
# placeholder in executa.json for offline builds.
PYBIN="$([ -x .venv/Scripts/python.exe ] && echo .venv/Scripts/python.exe || { command -v python3 || command -v python || command -v py; })"
# ensure_ascii=True keeps this payload pure ASCII — Windows CI consoles default
# to cp1252 and would crash printing CJK to stdout.
META="$("$PYBIN" -c "import json;d=json.load(open('executa.json',encoding='utf-8'));t=json.load(open('.anna/executa.json',encoding='utf-8'))['tool_id'] if __import__('os').path.exists('.anna/executa.json') else d['tool_id'];print(json.dumps([t,d.get('version') or '0.0.0',d.get('name') or d['tool_id'],d.get('description') or ''],ensure_ascii=True))")"
TOOL_ID="$(printf '%s' "$META" | "$PYBIN" -c "import json,sys;print(json.loads(sys.stdin.read())[0])")"
VERSION="$(printf '%s' "$META" | "$PYBIN" -c "import json,sys;print(json.loads(sys.stdin.read())[1])")"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x86_64" ;;
  arm64|aarch64) ARCH="arm64" ;;
esac
# Git Bash reports e.g. "mingw64_nt-10.0-26200"; reduce to the kernel family.
case "$OS" in mingw*|msys*|cygwin*|windows*) OS="windows" ;; esac

EXE_SUFFIX=""
case "$OS-$ARCH" in
  linux-x86_64|linux-arm64|linux-aarch64) PLATFORM="$OS-$ARCH" ;;
  darwin-arm64|darwin-x86_64) PLATFORM="$OS-$ARCH" ;;
  mingw64-x86_64|msys-x86_64|windows-x86_64)
    PLATFORM="windows-x86_64"
    EXE_SUFFIX=".exe"
    ;;
  *)
    echo "ERROR: unsupported platform: $OS-$ARCH" >&2
    exit 1
    ;;
esac

echo "Tool ID: $TOOL_ID"
echo "Version: $VERSION"
echo "Platform: $PLATFORM"
echo

rm -rf build dist "$OUT_DIR/staging-$PLATFORM"
mkdir -p "$OUT_DIR/staging-$PLATFORM/bin"

echo "==> Building single-file executable with PyInstaller"
PYINSTALLER_ENV="$([ -n "${PYINSTALLER_PYTHON:-}" ] && echo "$PYINSTALLER_PYTHON" || echo "uv run --with pyinstaller python")"
# Keep the artifact under the platform's ~20 MiB download ceiling:
# exclude heavy stdlib/tooling modules the plugin never uses.
$PYINSTALLER_ENV -m PyInstaller \
  --onefile \
  --clean \
  --noupx \
  --name "$TOOL_ID" \
  --exclude-module tkinter \
  --exclude-module unittest \
  --exclude-module doctest \
  --exclude-module pydoc \
  --exclude-module lib2to3 \
  --exclude-module distutils \
  --exclude-module ensurepip \
  --exclude-module setuptools \
  --exclude-module pip \
  --exclude-module numpy \
  --exclude-module pandas \
  --exclude-module matplotlib \
  --exclude-module xlsxwriter \
  --exclude-module sqlite3 \
  --exclude-module multiprocessing \
  --exclude-module asyncio \
  --exclude-module zoneinfo \
  --exclude-module csv \
  --exclude-module plistlib \
  --exclude-module pydoc_data \
  --exclude-module xmlrpc \
  --exclude-module ftplib \
  --exclude-module imaplib \
  --exclude-module poplib \
  --exclude-module smtplib \
  --exclude-module telnetlib \
  --exclude-module nntplib \
  --exclude-module mailbox \
  --exclude-module curses \
  --exclude-module dbm \
  --exclude-module turtle \
  --exclude-module idlelib \
  --exclude-module lxml.objectify \
  --exclude-module lxml.html \
  --exclude-module lxml.isoschematron \
  --exclude-module lxml.sax \
  --exclude-module lxml.cssselect \
  "$ENTRY_FILE"

BINARY="dist/$TOOL_ID$EXE_SUFFIX"
if [ ! -f "$BINARY" ]; then
  echo "ERROR: PyInstaller did not produce $BINARY" >&2
  exit 1
fi

STAGE="$OUT_DIR/staging-$PLATFORM"
cp "$BINARY" "$STAGE/bin/$TOOL_ID$EXE_SUFFIX"
chmod 0755 "$STAGE/bin/$TOOL_ID$EXE_SUFFIX"

echo "==> Writing archive manifest"
"$PYBIN" - "$STAGE/manifest.json" "$TOOL_ID" "$VERSION" "$META" "bin/$TOOL_ID$EXE_SUFFIX" <<'PY'
import json, sys
manifest_path, tool_id, version, meta_json, entrypoint = sys.argv[1:6]
# meta_json is ASCII-safe (ensure_ascii) — parse to recover the original
# (possibly CJK) display name / description without console encoding issues.
_, _, display_name, description = json.loads(meta_json)
manifest = {
    "name": tool_id,
    "display_name": display_name,
    "version": version,
    "description": description,
    "runtime": {
        "binary": {
            "entrypoint": {"default": entrypoint},
            "permissions": {entrypoint: "0o755"},
        }
    },
}
with open(manifest_path, "w", encoding="utf-8") as f:
    f.write(json.dumps(manifest, indent=2) + "\n")
PY

ARCHIVE="$OUT_DIR/$TOOL_ID-$PLATFORM.tar.gz"
echo "==> Creating archive: $ARCHIVE"
( cd "$STAGE" && tar czf "../$TOOL_ID-$PLATFORM.tar.gz" . )

if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
else
  SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
fi
SIZE="$(wc -c < "$ARCHIVE" | tr -d ' ')"
echo
echo "Built archive: $ARCHIVE"
echo "SHA-256: $SHA256"
echo "Size: $SIZE bytes"
echo
tar tzf "$ARCHIVE"

#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is macOS-only (Homebrew)." >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh then re-run this script." >&2
  exit 1
fi

if brew list --formula bao >/dev/null 2>&1; then
  echo "Homebrew formula 'bao' is installed and conflicts with 'openbao' (both ship a 'bao' binary)." >&2
  echo "Uninstall it yourself if you want OpenBao's CLI: brew uninstall bao" >&2
  echo "This script will not unlink or uninstall packages." >&2
  exit 1
fi

brew install kubernetes-cli openbao gh

missing=0
for bin in kubectl bao gh; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Expected '$bin' on PATH after brew install." >&2
    missing=1
  fi
done
if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

echo
echo "Installed CLIs:"
kubectl version --client
echo
bao version
echo
gh --version

#!/bin/bash
set -euo pipefail

CSV_FILE="/tmp/live_pixels.csv"
#Test Pixel Validation Project: 1210584574754345
#Pixel Validation Project:      1210856607616307

# Check if all required arguments are provided
if [ $# -lt 3 ]; then
    echo "Usage: $0 <Pixel Definitions Dir> <USER_MAP> <ASANA_PROJECT> [RELEASE_TAG_TEMPLATE]"
    echo "Example: $0 ../duckduckgo-privacy-extension/pixel-definitions/ ../internal-github-asana-utils/user_map.yml 1210584574754345 "
    exit 1
fi

MAIN_DIR="$1"
USER_MAP="$2"
ASANA_PROJECT="$3"
RELEASE_TAG_TEMPLATE="${4:-}"
RELEASE_MAIN_DIR=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
    if [ -n "$RELEASE_MAIN_DIR" ]; then
        git -C "$MAIN_DIR_REPO" worktree remove --force "$RELEASE_WORKTREE"
    fi
}

MAIN_DIR="$(realpath "$MAIN_DIR")"
RELEASE_OUTPUT="$(node "$SCRIPT_DIR/../bin/resolve_release_tag.mjs" "$MAIN_DIR" "$RELEASE_TAG_TEMPLATE")"

if [ -n "$RELEASE_OUTPUT" ]; then
    mapfile -t RELEASE_VALUES <<< "$RELEASE_OUTPUT"
    RELEASE_VERSION="${RELEASE_VALUES[0]}"
    RELEASE_TAG="${RELEASE_VALUES[1]}"
    MAIN_DIR_REPO="$(git -C "$MAIN_DIR" rev-parse --show-toplevel)"
    MAIN_DIR_RELATIVE="$(realpath --relative-to="$MAIN_DIR_REPO" "$MAIN_DIR")"
    RELEASE_WORKTREE="$(mktemp -d)"
    rmdir "$RELEASE_WORKTREE"
    trap cleanup EXIT

    echo "Resolving release tag '$RELEASE_TAG' for $MAIN_DIR_REPO"
    git -C "$MAIN_DIR_REPO" fetch origin "refs/tags/$RELEASE_TAG"
    RELEASE_SHA="$(git -C "$MAIN_DIR_REPO" rev-parse 'FETCH_HEAD^{commit}')"
    RELEASE_DATE="$(git -C "$MAIN_DIR_REPO" show -s --format=%cI "$RELEASE_SHA")"
    echo "Release definitions: product=$MAIN_DIR version=$RELEASE_VERSION template=$RELEASE_TAG_TEMPLATE tag=$RELEASE_TAG sha=$RELEASE_SHA date=$RELEASE_DATE"
    git -C "$MAIN_DIR_REPO" worktree add --detach "$RELEASE_WORKTREE" "$RELEASE_SHA"
    RELEASE_MAIN_DIR="$RELEASE_WORKTREE/$MAIN_DIR_RELATIVE"

    echo "Preprocess release defs"
    fnm exec npm run preprocess-defs "$RELEASE_MAIN_DIR"
else
    echo "No application version target; validating HEAD definitions only"
fi

echo "Preprocess defs"
fnm exec npm run preprocess-defs "$MAIN_DIR"

echo "Fetch Clickhouse"
fnm exec npm run fetch-clickhouse-data "$MAIN_DIR"

echo "Validate pixels"
fnm exec npm run validate-live-pixels "$MAIN_DIR" "$CSV_FILE" "$RELEASE_MAIN_DIR"

echo "Generate Asana reports"
fnm exec npm run asana-reports "$MAIN_DIR" "$USER_MAP" "$ASANA_PROJECT"

rm -rf "$CSV_FILE"

exit 0

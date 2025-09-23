#!/bin/bash
set -euo pipefail

CSV_FILE="/tmp/live_pixels.csv"

# Check if all required arguments are provided
if [ $# -lt 1 ]; then
    echo "Usage: $0 <Pixel Definitions Dir>"
    echo "Example: $0 ../duckduckgo-privacy-extension/pixel-definitions/"
    echo "This script just preprocesses the defs and validates live pixels, without re-fetching pixels or generating reports."
    exit 1
fi

MAIN_DIR="$1"

echo "Preprocess defs"
fnm exec npm run preprocess-defs $MAIN_DIR

echo "Validate pixels"
fnm exec npm run validate-live-pixels $MAIN_DIR $CSV_FILE

rm -rf $CSV_FILE

exit 0

#!/bin/bash
set -euo pipefail

CSV_FILE="/tmp/live_pixels.csv"
#Test Pixel Validation Project: 1210584574754345
#Pixel Validation Project:      1210856607616307

# Check if all required arguments are provided
if [ $# -lt 3 ]; then
    echo "Usage: $0 <Pixel Definitions Dir>  <USER_MAP> <ASANA_PROJECT>"
    echo "Example: $0 ../duckduckgo-privacy-extension/pixel-definitions/ ../internal-github-asana-utils/user_map.yml 1210584574754345 "
    exit 1
fi

MAIN_DIR="$1"
USER_MAP="$2"
ASANA_PROJECT="$3"

echo "Preprocess defs"
fnm exec npm run preprocess-defs $MAIN_DIR

echo "Fetch Clickhouse"
fnm exec npm run fetch-clickhouse-data $MAIN_DIR

echo "Validate pixels"
fnm exec npm run validate-live-pixels $MAIN_DIR $CSV_FILE 

echo "Generate Asana reports"
fnm exec npm run asana-reports $MAIN_DIR $USER_MAP $ASANA_PROJECT

rm -rf $CSV_FILE

exit 0

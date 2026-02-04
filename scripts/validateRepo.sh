#!/bin/bash
set -euo pipefail

# Pixel validation script for Asana reports and optionally dashboard output.
#
# This script:
# 1. Preprocesses pixel definitions
# 2. Fetches pixel data from ClickHouse (sampled data from metrics.pixels_validation)
# 3. Validates pixels against definitions
# 4. Generates Asana reports with validation errors
# 5. Optionally: Outputs to dashboard ClickHouse table if --dashboard flag is set
#
# The dashboard output uses aggregated data from metrics.pixels_validation_aggregated
# (populated by prefect-etl) to avoid expensive direct queries to metrics.pixels.

CSV_FILE="/tmp/live_pixels.csv"
#Test Pixel Validation Project: 1210584574754345
#Pixel Validation Project:      1210856607616307

# Check if all required arguments are provided
if [ $# -lt 3 ]; then
    echo "Usage: $0 <Pixel Definitions Dir> <USER_MAP> <ASANA_PROJECT> [--dashboard <DATE>]"
    echo "Example: $0 ../duckduckgo-privacy-extension/pixel-definitions/ ../internal-github-asana-utils/user_map.yml 1210584574754345"
    echo ""
    echo "Options:"
    echo "  --dashboard <DATE>  Also output to dashboard ClickHouse table for the given date (YYYY-MM-DD)"
    exit 1
fi

MAIN_DIR="$1"
USER_MAP="$2"
ASANA_PROJECT="$3"
DASHBOARD_DATE=""

# Check for --dashboard flag
if [ "${4:-}" = "--dashboard" ]; then
    if [ -z "${5:-}" ]; then
        echo "Error: --dashboard requires a date argument (YYYY-MM-DD)"
        exit 1
    fi
    DASHBOARD_DATE="$5"
fi

echo "Preprocess defs"
fnm exec npm run preprocess-defs $MAIN_DIR

echo "Fetch Clickhouse (sampled data for Asana reports)"
fnm exec npm run fetch-clickhouse-data $MAIN_DIR

echo "Validate pixels"
fnm exec npm run validate-live-pixels $MAIN_DIR $CSV_FILE

echo "Generate Asana reports"
fnm exec npm run asana-reports $MAIN_DIR $USER_MAP $ASANA_PROJECT

rm -rf $CSV_FILE

# Optional: Dashboard output using aggregated data
if [ -n "$DASHBOARD_DATE" ]; then
    echo ""
    echo "=== Dashboard Output ==="
    echo "Generating dashboard data for date: $DASHBOARD_DATE"

    TMP_DIR=$(mktemp -d /tmp/dashboard_validation_${DASHBOARD_DATE}.XXXX)
    DASHBOARD_CSV_FILE="$TMP_DIR/aggregated_pixels.csv"
    export DETAILED_VALIDATION_OUTPUT_FILE="$TMP_DIR/validation_results.jl"
    export DISABLE_RESULT_SAVING=1

    echo "Fetching aggregated data from metrics.pixels_validation_aggregated..."
    fnm exec node live_validation_scripts/fetch_aggregated_pixels.mjs $DASHBOARD_DATE $MAIN_DIR $DASHBOARD_CSV_FILE

    echo "Validating aggregated pixels..."
    fnm exec node live_validation_scripts/validate_live_pixel.mjs $MAIN_DIR $DASHBOARD_CSV_FILE

    echo "Inserting results into pixels.validation_results_2..."
    cat $DETAILED_VALIDATION_OUTPUT_FILE | ddg-rw-ch -h clickhouse --query "INSERT INTO pixels.validation_results_2 FORMAT JSONEachRow"

    rm -rf $TMP_DIR
    echo "Dashboard output complete."
fi

exit 0

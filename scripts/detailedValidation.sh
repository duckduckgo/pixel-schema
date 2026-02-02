#!/bin/bash
set -ex


# Check if all required arguments are provided
if [ $# -lt 2 ]; then
    echo "Usage: $0 <Pixel Definitions Dir> <Date>"
    echo "Example: $0 ../duckduckgo-privacy-extension/pixel-definitions/ 2026-01-27"
    exit 1
fi

DEFINITIONS_DIR="$1"
DATE="$2"

TMP_DIR=`mktemp -d /tmp/detailed_validation_${DATE}.XXXX`
PIXEL_CSV_FILE="$TMP_DIR/live_pixels.csv" 
export DETAILED_VALIDATION_OUTPUT_FILE="$TMP_DIR/validation_results.jl"
export DISABLE_RESULT_SAVING=1

# Preprocess pixel definitions
fnm exec npm run preprocess-defs $DEFINITIONS_DIR

# Fetch pixels from Clickhouse and store in a CSV file
fnm exec node live_validation_scripts/fetch_pixels_for_day.mjs $DATE $DEFINITIONS_DIR $PIXEL_CSV_FILE
# Process pixels and store detailed validation results in a JSONL file
fnm exec node live_validation_scripts/validate_live_pixel.mjs $DEFINITIONS_DIR $PIXEL_CSV_FILE

# Insert detailed validation results into Clickhouse
cat $DETAILED_VALIDATION_OUTPUT_FILE | ddg-rw-ch -h clickhouse --query "INSERT INTO pixels.validation_results_2 FORMAT JSONEachRow"

# Cleanup
rm -r $TMP_DIR
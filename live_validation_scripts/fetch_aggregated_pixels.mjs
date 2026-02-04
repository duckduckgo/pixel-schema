#!/usr/bin/env node
/**
 * Fetches pre-aggregated pixel data from metrics.pixels_validation_aggregated
 * (populated by prefect-etl's pixels_validation_aggregated.py)
 *
 * This is more efficient than fetch_pixels_for_day.mjs which queries
 * metrics.pixels directly. The aggregation is done once in prefect-etl
 * and this script just reads the pre-computed results.
 *
 * Usage: node fetch_aggregated_pixels.mjs <date> <dirPath> <csvFile>
 * Example: node fetch_aggregated_pixels.mjs 2026-01-27 ../extension/pixel-definitions/ /tmp/pixels.csv
 */

import { spawnSync } from 'child_process';
import { dirname } from 'path';

import * as fileUtils from '../src/file_utils.mjs';

const [date, dirPath, csvFile] = process.argv.slice(2);

if (!date || !dirPath || !csvFile) {
    console.error('Usage: node fetch_aggregated_pixels.mjs <date> <dirPath> <csvFile>');
    console.error('Example: node fetch_aggregated_pixels.mjs 2026-01-27 ../extension/pixel-definitions/ /tmp/pixels.csv');
    process.exit(1);
}

async function main(day, mainDir, csvFile) {
    const productDef = fileUtils.readProductDef(mainDir);
    console.log(`Fetching aggregated pixels for day: ${day}, for ${dirname(mainDir)}`);

    // Build agent filter from product definition
    const agentFilter = productDef.agents.map((agent) => `'${agent}'`).join(',');

    // Query the pre-aggregated table (populated by prefect-etl)
    // This avoids scanning metrics.pixels directly
    const query = `
    SELECT
        date,
        agent,
        version,
        pixel_id,
        pixel,
        params,
        freq
    FROM metrics.pixels_validation_aggregated
    WHERE date = '${day}'
        AND agent IN (${agentFilter})
    INTO OUTFILE '${csvFile}'
    FORMAT CSVWithNames
    `;

    console.log('Executing query against metrics.pixels_validation_aggregated...');
    const result = spawnSync('ddg-ro-ch', ['-h', 'clickhouse', '--query', query]);

    if (result.error) {
        console.error('Error executing query:', result.error);
        process.exit(1);
    }

    if (result.stderr.toString().trim()) {
        console.log(result.stderr.toString());
    }
    if (result.stdout.toString().trim()) {
        console.log(result.stdout.toString());
    }

    console.log(`Data written to ${csvFile}`);
}

main(date, dirPath, csvFile).catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});

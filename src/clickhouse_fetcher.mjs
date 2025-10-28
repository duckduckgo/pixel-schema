import fs from 'fs';
import { spawn, spawnSync } from 'child_process';

import { PIXELS_TMP_CSV } from './constants.mjs';
import { readTokenizedPixels, readProductDef, readNativeExperimentsDef } from './file_utils.mjs';

const MAX_MEMORY = 2 * 1024 * 1024 * 1024; // 2GB
const TABLE_NAME = 'metrics.pixels_validation';
const CH_BIN = 'ddg-rw-ch';
const CH_ARGS = [`--max_memory_usage=${MAX_MEMORY}`, '-h', 'clickhouse', '--query'];

/**
 * @param {object} tokenizedPixels similar in format to schemas/pixel_schema.json5.
 * See tests/test_data/valid/expected_processing_results/tokenized_pixels.json for an example.
 * @param {object} productDef schema is a TODO.
 * See tests/test_data/valid/product.json for an example.
 */
function prepareCSVQuery(pixelIDs, productDef) {
    const pixelIDsWhereClause = pixelIDs.map((id) => `pixel_id = '${id.split('-')[0]}'`).join(' OR ');
    const agentWhereClause = productDef.agents.map((agent) => `agent = '${agent}'`).join(' OR ');
    let dateFilter = '';

    if (productDef.target.queryWindowInDays) {
        const days = productDef.target.queryWindowInDays;
        console.log(`Query window: ${days} days`);
        // Append date filter to the where clause
        dateFilter = `AND (updated_at >= today() - ${days})`;
    }

    const queryString = `
        SELECT pixel, params, version
        FROM ${TABLE_NAME}
        WHERE (${agentWhereClause})
        AND (${pixelIDsWhereClause})
        ${dateFilter};`;

    return queryString;
}

function updatePixelIDs(pixelIDs) {
    const values = pixelIDs
        .map((id) => `'${id.split('-')[0]}'`)
        .join(',today()), (')
        .concat(',today()');
    const queryString = `
        INSERT INTO metrics.pixels_validation_pixel_ids (pixel_id, updated_at)
        VALUES (${values});`;

    console.log('Updating pixels IDs with:', pixelIDs.toString());

    const result = spawnSync(CH_BIN, CH_ARGS.concat([queryString]));
    if (result.error) {
        console.error('Error executing clickhouse-client:', result.error);
        throw new Error('Error inserting pixel IDs. Check logs above.');
    }
}

async function outputTableToCSV(queryString) {
    console.log('Preparing CSV');

    const chPromise = new Promise((resolve, reject) => {
        const outputStream = fs.createWriteStream(PIXELS_TMP_CSV);

        // Handle stream errors
        outputStream.on('error', function (err) {
            reject(new Error(`Failed to write to file ${PIXELS_TMP_CSV}: ${err.message}`));
        });

        const clickhouseProcess = spawn(CH_BIN, CH_ARGS.concat([queryString, '--format=CSVWithNames']));

        // Handle backpressure properly
        let isPaused = false;

        clickhouseProcess.stdout.on('data', function (data) {
            try {
                const writeResult = outputStream.write(data);
                if (!writeResult && !isPaused) {
                    // Buffer is full, pause the readable stream to prevent memory buildup
                    isPaused = true;
                    clickhouseProcess.stdout.pause();

                    // Wait for drain event to resume
                    outputStream.once('drain', function () {
                        isPaused = false;
                        clickhouseProcess.stdout.resume();
                    });
                }
            } catch (err) {
                reject(new Error(`Failed to write data to ${PIXELS_TMP_CSV}: ${err.message}`));
            }
        });

        clickhouseProcess.stderr.on('data', function (data) {
            reject(new Error(data.toString()));
        });

        clickhouseProcess.on('close', function (code) {
            outputStream.end();
            if (code !== 0) {
                reject(new Error(`clickhouse-client process exited with code ${code}`));
            }
            resolve();
        });
    });

    await chPromise
        .then(() => {
            console.log('CSV file ready');
        })
        .catch((err) => {
            console.error(err);
            throw new Error('Error outputing data to CSV. Check logs above.');
        });
}

function preparePixelIDs(mainPixelDir) {
    const tokenizedPixels = readTokenizedPixels(mainPixelDir);
    const nativeExperimentsDef = readNativeExperimentsDef(mainPixelDir);
    const nativeExperimentsDefined = Object.keys(nativeExperimentsDef.activeExperiments).length > 0;

    const pixelIDs = Object.keys(tokenizedPixels);
    if (nativeExperimentsDefined) {
        pixelIDs.push('experiment'); // add native "experiment.*" pixels to the list of pixel IDs (defined outside tokenized defs)
    }

    return pixelIDs;
}

export async function preparePixelsCSV(mainPixelDir) {
    try {
        const pixelIDs = preparePixelIDs(mainPixelDir);

        updatePixelIDs(pixelIDs);
        const queryString = prepareCSVQuery(pixelIDs, readProductDef(mainPixelDir));
        await outputTableToCSV(queryString);
    } catch (err) {
        console.error(err);
    }
}

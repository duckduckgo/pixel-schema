import fs from 'fs';
import { spawn, spawnSync } from 'child_process';

import { PIXELS_TMP_CSV } from './constants.mjs';
import { readTokenizedPixels, readProductDef } from './file_utils.mjs';

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
function prepareCSVQuery(tokenizedPixels, productDef) {
    const pixelIDs = Object.keys(tokenizedPixels);
    pixelIDs.push('experiment'); // add experiment to the list of pixel IDs (defined outside tokenized defs)
    const pixelIDsWhereClause = pixelIDs.map((id) => `pixel_id = '${id.split('-')[0]}'`).join(' OR ');
    const agentWhereClause = productDef.agents.map((agent) => `agent = '${agent}'`).join(' OR ');

    const queryString = `
        SELECT pixel, params
        FROM ${TABLE_NAME}
        WHERE (${agentWhereClause})
        AND (${pixelIDsWhereClause});`;

    return queryString;
}

function updatePixelIDs(tokenizedPixels) {
    const pixelIDs = Object.keys(tokenizedPixels);
    pixelIDs.push('experiment');
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
        const clickhouseProcess = spawn(CH_BIN, CH_ARGS.concat([queryString, '--format=CSVWithNames']));
        clickhouseProcess.stdout.on('data', function (data) {
            outputStream.write(data);
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

export async function preparePixelsCSV(mainPixelDir) {
    try {
        const tokenizedPixels = readTokenizedPixels(mainPixelDir);
        updatePixelIDs(tokenizedPixels);
        const queryString = prepareCSVQuery(tokenizedPixels, readProductDef(mainPixelDir));
        await outputTableToCSV(queryString);
    } catch (err) {
        console.error(err);
    }
}

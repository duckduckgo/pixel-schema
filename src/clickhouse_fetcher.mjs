import fs from 'fs';
import { spawn, spawnSync } from 'child_process';

import { PIXELS_TMP_CSV } from './constants.mjs';
import { readTokenizedPixels, readProductDef } from './file_utils.mjs';

const MAX_MEMORY = 2 * 1024 * 1024 * 1024; // 2GB
const TMP_TABLE_NAME = 'temp.pixel_validation';
const CH_ARGS = [`--max_memory_usage=${MAX_MEMORY}`, '-h', 'clickhouse', '--query'];
// TODO Better to pass in start day and end day as parameters


// Audit DAYS_TO_FETCH full days in chunks, not including the current day
// Will get more repeatable results run to run if we don't include current day
// because the current day is still changing
const DAYS_TO_FETCH = 7; // Number of days to fetch pixels for; Reduce this (e.g. to 7) if hit limit on JSON size in validate_live_pixel.mjs


// Process each day in chunks
// A full day exceed the memory limit of clickhouse in some cases\
//recommend an even divisor of 24 - 1,2, 3, 4, 6, 8, 12, 24
const HOURS_IN_BATCH = 24;

function createTempTable() {
    //TODO: if table exists already, drop it
    
    const queryString = `CREATE TABLE ${TMP_TABLE_NAME}
        (
            \`pixel\` String,
            \`params\` String
        )
        ENGINE = MergeTree
        ORDER BY params;
        `;
    const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat(queryString));
    const resultErr = clickhouseQuery.stderr.toString();
    if (resultErr) {
        throw new Error(`Error creating table:\n ${resultErr}`);
    } else {
        console.log('Table created');
    }
}

/**
 * @param {object} tokenizedPixels similar in format to schemas/pixel_schema.json5.
 * See tests/test_data/valid/expected_processing_results/tokenized_pixels.json for an example.
 * @param {object} productDef schema is a TODO.
 * See tests/test_data/valid/product.json for an example.
 */
function populateTempTable(tokenizedPixels, productDef) {
    console.log('Populating table');

    const pixelIDs = Object.keys(tokenizedPixels);
    pixelIDs.push('experiment'); // add experiment to the list of pixel IDs (defined outside tokenized defs)
    const pixelIDsWhereClause = pixelIDs.map((id) => `pixel_id = '${id.split('-')[0]}'`).join(' OR ');
    const agentWhereClause = productDef.agents.map((agent) => `agent = '${agent}'`).join(' OR ');

    // This will get the current time as well
    let currentDate = new Date();

    // This sets the time to midnight so we get full days starting at midnight
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

    console.log(`Current date ${currentDate.toISOString().split('T')[0]}`);

    const pastDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - DAYS_TO_FETCH);
    // Ensure pastDate starts at exactly 0:00:00.000
    pastDate.setHours(0, 0, 0, 0);
    /* eslint-disable no-unmodified-loop-condition */

   
    while (pastDate < currentDate) {
        
       for (let hour = 0; hour < 24; hour += HOURS_IN_BATCH) {
            const startTime = new Date(pastDate);
            startTime.setHours(hour, 0, 0, 0);
            
            const endTime = new Date(pastDate);
            endTime.setHours(hour + HOURS_IN_BATCH, 0, 0, 0);

            const queryString = `INSERT INTO ${TMP_TABLE_NAME} (pixel, params)
                WITH extractURLParameters(request) AS params
                SELECT any(pixel), arrayFilter(x -> not match(x, '^\\\\d+=?$'), params) AS filtered_params
                FROM metrics.pixels
                WHERE (${pixelIDsWhereClause}) 
                AND (${agentWhereClause})
                AND request NOT ILIKE '%test=1%'
                AND timestamp >= {startTime:DateTime}
                AND timestamp < {endTime:DateTime}
                GROUP BY filtered_params;`;
            
            const params = [
                `--param_startTime=${startTime.toISOString().replace('T', ' ').replace('.000Z', '')}`,
                `--param_endTime=${endTime.toISOString().replace('T', ' ').replace('.000Z', '')}`
            ];

            console.log(`...Executing query for ${HOURS_IN_BATCH}-hour chunk: ${startTime.toISOString()} to ${endTime.toISOString()}`);
            console.log(`\t...With params ${params.join(' ')}`);

            const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat([queryString]).concat(params));
            const resultErr = clickhouseQuery.stderr.toString();
            if (resultErr) {
                throw new Error(`Error inserting data for time range ${startTime.toISOString()} to ${endTime.toISOString()}:\n ${resultErr}`);
            }
        }

        pastDate.setDate(pastDate.getDate() + 1);
    }
    /* eslint-enable no-unmodified-loop-condition */
}

async function outputTableToCSV() {
    console.log('Preparing CSV');
    
    // First check if there's any data in the temp table
    const countQuery = `SELECT COUNT(*) FROM ${TMP_TABLE_NAME};`;
    const countResult = spawnSync('clickhouse-client', CH_ARGS.concat([countQuery]));
    const rowCount = parseInt(countResult.stdout.toString().trim());
    
    if (rowCount === 0) {
        console.warn(`Warning: No pixel data found for the specified date range (${DAYS_TO_FETCH} days)`);
        // Still create the CSV with headers for consistency
    }
    
    const chPromise = new Promise((resolve, reject) => {
        const outputStream = fs.createWriteStream(PIXELS_TMP_CSV);
        const queryString = `SELECT DISTINCT pixel, params FROM ${TMP_TABLE_NAME};`;
        const clickhouseProcess = spawn('clickhouse-client', CH_ARGS.concat([queryString, '--format=CSVWithNames']));
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

    await Promise.all([chPromise])
        .then(() => {
            console.log('CSV file ready');
        })
        .catch((err) => {
            console.error(err);
            throw new Error('Error outputing data to CSV. Check logs above.');
        });
}

function deleteTempTable() {
    console.log('Deleting table');
    const queryString = `DROP TABLE IF EXISTS ${TMP_TABLE_NAME};`;
    const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat(queryString));
    const resultErr = clickhouseQuery.stderr.toString();
    if (resultErr) {
        throw new Error(`Error deleting table:\n ${resultErr}`);
    }
}

export async function preparePixelsCSV(mainPixelDir) {
    try {
        createTempTable();
        populateTempTable(readTokenizedPixels(mainPixelDir), readProductDef(mainPixelDir));
        await outputTableToCSV();
    } catch (err) {
        console.error(err);
        throw new Error('Error preparing pixels CSV.');
    } finally {
        deleteTempTable();
    }
}

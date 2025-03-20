import fs from 'fs';
import { spawn, spawnSync } from 'child_process';

import { PIXELS_TMP_CSV } from './constants.mjs';
import { readTokenizedPixels, readProductDef } from './file_utils.mjs';

const MAX_MEMORY = 2 * 1024 * 1024 * 1024; // 2GB
const TMP_TABLE_NAME = 'temp.pixel_validation';
const CH_ARGS = [`--max_memory_usage=${MAX_MEMORY}`, '-h', 'clickhouse', '--query'];

function createTempTable() {
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
    const pixelIDsWhereClause = pixelIDs.map((id) => `pixel_id = '${id.split('-')[0]}'`).join(' OR ');
    const agentWhereClause = productDef.agents.map((agent) => `agent = '${agent}'`).join(' OR ');

    const currentDate = new Date();
    const pastDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 28);
    /* eslint-disable no-unmodified-loop-condition */
    while (pastDate <= currentDate) {
        const queryString = `INSERT INTO ${TMP_TABLE_NAME} (pixel, params)
            WITH extractURLParameters(request) AS params
            SELECT any(pixel), arrayFilter(x -> not match(x, '^\\\\d+$'), params) AS filtered_params
            FROM metrics.pixels
            WHERE (${pixelIDsWhereClause}) 
            AND (${agentWhereClause})
            AND request NOT ILIKE '%test=1%'
            AND date = {pDate:Date}
            GROUP BY filtered_params;`;
        const params = `--param_pDate=${pastDate.toISOString().split('T')[0]}`;

        console.log(`...Executing query ${queryString}`);
        console.log(`\t...With params ${params}`);

        const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat([queryString, params]));
        const resultErr = clickhouseQuery.stderr.toString();
        if (resultErr) {
            throw new Error(`Error creating table:\n ${resultErr}`);
        }

        pastDate.setDate(pastDate.getDate() + 1);
    }
    /* eslint-enable no-unmodified-loop-condition */
}

async function outputTableToCSV() {
    console.log('Preparing CSV');

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
    } finally {
        deleteTempTable();
    }
}

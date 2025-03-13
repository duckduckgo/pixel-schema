import fs from 'fs';
import { spawn, spawnSync } from 'child_process';

import { PIXELS_TMP_CSV } from './constants.mjs';
import { getTokenizedPixels, getProductDef } from './file_utils.mjs';

const MAX_MEMORY = 2 * 1024 * 1024 * 1024; // 2GB
const TMP_TABLE_NAME = 'temp.pixel_validation';
const CH_ARGS = [
    `--max_memory_usage=${MAX_MEMORY}`,
    '-h', 
    'clickhouse',
    '--query'
]

function createTempTable() {
    const queryString = `CREATE TABLE ${TMP_TABLE_NAME}
        (
            \`pixel\` String,
            \`request\` String
        )
        ENGINE = MergeTree
        ORDER BY request;
        `;
    const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat(queryString));
    const resultErr = clickhouseQuery.stderr.toString();
    if (resultErr) {
        throw new Error(`Error creating table:\n ${resultErr}`);
    } else {
        console.log('Table created');
    }
}

function populateTempTable(tokenizedPixels, productDef) {
    console.log('Populating table');

    const pixelIDs = Object.keys(tokenizedPixels);
    const pixelIDsWhereClause = pixelIDs.map(id => `pixel_id = '${id.split('-')[0]}'`).join(' OR ');
    const agentWhereClause = productDef.agents.map(agent => `agent = '${agent}'`).join(' OR ');

    const currentDate = new Date();
    const pastDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 28);
    while (pastDate <= currentDate) {
        const queryString = `INSERT INTO ${TMP_TABLE_NAME} (pixel, request)
            SELECT any(pixel), request
            FROM metrics.pixels
            WHERE (${pixelIDsWhereClause}) 
            AND (${agentWhereClause})
            AND request NOT ILIKE '%test=1%'
            AND date = '${pastDate.toISOString().split('T')[0]}'
            GROUP BY request;
            `;

        console.log('...Inserting data with query:');
        console.log(queryString);

        const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat(queryString));
        const resultErr = clickhouseQuery.stderr.toString();
        if (resultErr) {
            throw new Error(`Error creating table:\n ${resultErr}`);
        }

        pastDate.setDate(pastDate.getDate() + 1);
    }
}

async function outputTableToCSV() {
    console.log('Preparing CSV');

    const chPromise = new Promise((resolve, reject) => {
        const outputStream = fs.createWriteStream(PIXELS_TMP_CSV);
        const queryString = `SELECT DISTINCT pixel, request FROM ${TMP_TABLE_NAME};`;
        const clickhouseProcess = spawn('clickhouse-client', CH_ARGS.concat([queryString, '--format=CSVWithNames']));
        clickhouseProcess.stdout.on('data', function(data) {
            outputStream.write(data);
        });
        
        clickhouseProcess.stderr.on('data', function(data) {
            reject(data.toString());
        });
        
        clickhouseProcess.on('close', function(code) {
            outputStream.end();
            if (code !== 0) {
                reject(`clickhouse-client process exited with code ${code}`);
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
    const queryString = `DROP TABLE ${TMP_TABLE_NAME};`;
    const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat(queryString));
    const resultErr = clickhouseQuery.stderr.toString();
    if (resultErr) {
        throw new Error(`Error deleting table:\n ${resultErr}`);
    }
}

export async function preparePixelsCSV(mainPixelDir) {
    createTempTable();
    populateTempTable(getTokenizedPixels(mainPixelDir), getProductDef(mainPixelDir));
    await outputTableToCSV();
    deleteTempTable();
}

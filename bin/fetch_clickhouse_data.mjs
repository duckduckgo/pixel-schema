import fs from 'fs';
import path from 'path';

import { getArgParser } from '../src/args_utils.mjs';
import { spawn, spawnSync } from 'child_process';

const MAX_MEMORY = 2 * 1024 * 1024 * 1024; // 2GB
const TEMP_TABLE_NAME = 'temp.nastia_windows_pixels';
const CH_ARGS = [
    `--max_memory_usage=${MAX_MEMORY}`,
    '-h', 
    process.env.CLICKHOUSE_HOST,
    '--query'
]

const argv = getArgParser('TODO')
    .parse();

function outputTableToCSV() {
    const queryString = `SELECT pixel, request FROM ${TEMP_TABLE_NAME};`;

    const outputStream = fs.createWriteStream('live_pixels_no_dedup.csv');
    const clickhouseProcess = spawn('clickhouse-client', CH_ARGS.concat([queryString, '--format=CSVWithNames']));

    clickhouseProcess.stdout.setEncoding('utf8');
    clickhouseProcess.stdout.on('data', function(data) {
        outputStream.write(data);
    });
    
    // TODO: error handling
    clickhouseProcess.stderr.setEncoding('utf8');
    clickhouseProcess.stderr.on('data', function(data) {
        console.log('stderr: ' + data);
    });
    
    clickhouseProcess.on('close', function(code) {
        console.log('closing code: ' + code);
        outputStream.end();
    });    
}

function populateTempTable(tokenizedPixelsPath) {
    const tokenizedPixels = JSON.parse(fs.readFileSync(tokenizedPixelsPath));
    const pixelIDs = Object.keys(tokenizedPixels);
    const pixelIDsWhereClause = pixelIDs.map(id => `pixel_id = '${id.split('-')[0]}'`).join(' OR ');

    const currentDate = new Date();
    let pastDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 28);
    while (pastDate <= currentDate) {
        const queryString = `INSERT INTO ${TEMP_TABLE_NAME} (pixel, request)
            SELECT any(pixel), request
            FROM metrics.pixels
            WHERE (${pixelIDsWhereClause}) 
            AND agent = 'ddg_win_desktop'
            AND request NOT ILIKE '%test=1%'
            AND date = '${pastDate.toISOString().split('T')[0]}'
            GROUP BY request;
        `

        console.log(CH_ARGS.concat(queryString));

        const clickhouseQuery = spawnSync('clickhouse-client', CH_ARGS.concat(queryString));
        const resultString = clickhouseQuery.stdout.toString();
        const resultErr = clickhouseQuery.stderr.toString();
        if (resultErr) {
            console.log('clickhouse query error:', resultErr);
        } else {
            console.log(resultString);
        }

        pastDate.setDate(pastDate.getDate() + 1);
    }
}

function main() {
    // populateTempTable(path.join(argv.dirPath, 'tokenized_pixels.json'));
    outputTableToCSV();
}

main();

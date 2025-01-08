import fs from 'fs';
import JSON5 from 'json5';

import { ParamsValidator } from '../src/params_validator.mjs';
import { logErrors } from '../src/error_utils.mjs';
import { spawnSync } from 'child_process';
import { exit } from 'process';

const clickhouseHost = process.env.CLICKHOUSE_HOST

if (!clickhouseHost) {
    console.error('Please set CLICKHOUSE_HOST in your ENV');
    process.exit(1);
}

const args = process.argv.slice(2);
const mainDir = args[0];

const pixelDefs = JSON5.parse(fs.readFileSync(`${args[1]}`));
const commonParams = JSON5.parse(fs.readFileSync(`${mainDir}/common_params.json`));
const commonSuffixes = JSON5.parse(fs.readFileSync(`${mainDir}/common_suffixes.json`));
const paramsValidator = new ParamsValidator(commonParams, commonSuffixes);

function main() {
    console.log(`Processing pixels defined in ${args[1]}`)

    if (args[2]) {
        const prefix = args[2];
        const url = args[3];

        console.log('Validating', prefix)
        validateSinglePixel(pixelDefs, prefix, url);
    } else {
        const pixelQueryResults = queryClickhouse(pixelDefs);
        for (const prefix of Object.keys(pixelQueryResults)) {
            console.log('Validating', prefix, pixelQueryResults)
            validateQueryForPixels(prefix, pixelQueryResults[prefix], paramsValidator)
        }
    }
}

function queryClickhouse(pixelDefs) {
    const pixelQueryResults = {};
    for(const pixel of Object.keys(pixelDefs)) {
        console.log('Querying for', pixel)
        const pixel_id = pixel.split('.')[0];
        const clickhouseQuery = spawnSync( 'clickhouse-client', [ '--host',  clickhouseHost, '--query', `SELECT DISTINCT request FROM metrics.pixels WHERE pixel_id = '${pixel_id}' AND date > now() - INTERVAL 30 DAY AND pixel LIKE '${pixel}%' LIMIT 1000` ] );
        const resultString = clickhouseQuery.stdout.toString();
        const resultErr = clickhouseQuery.stderr.toString();
        if (resultErr) {
            console.log( 'clickhouse query error:', resultErr );
        } else {
            if (resultString) pixelQueryResults[pixel] = resultString;
        }
    }
    console.log('pixelQueryResults',pixelQueryResults);

    return pixelQueryResults;
}

function validateQueryForPixels(prefix, pixelQuery, paramsValidator) {

        const lines = pixelQuery.split('\n');
        for (const line of lines) {
            if (line == '') continue;
            const pixelRequest = line.split('/')[2];
            const parts = pixelRequest.split('?');
            const url = parts[1];
            const pixelDef = pixelDefs[prefix];

            logErrors(`ERRORS for '${pixelRequest}\n`, paramsValidator.validateLivePixels(pixelDef, prefix, line));
    }
}

function validateSinglePixel(pixelDefs, prefix, url) {
    logErrors('ERRORS:', paramsValidator.validateLivePixels(pixelDefs[prefix], prefix, url));
}

main();
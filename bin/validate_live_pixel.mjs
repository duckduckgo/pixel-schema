#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { ParamsValidator } from '../src/params_validator.mjs';
import { logErrors } from '../src/error_utils.mjs';
import { spawnSync } from 'child_process';

const clickhouseHost = process.env.CLICKHOUSE_HOST;

const args = process.argv.slice(2);
const mainDir = args[0];
// const pixelDefPath = args[1];
const prefix = args[2];

const productDef = JSON5.parse(fs.readFileSync(`${mainDir}/product.json`).toString());
// Whether to force all schemas and pixels to lowercase
const forceLowerCase = productDef.forceLowerCase;

const commonParams = JSON5.parse(getNormalizedCase(fs.readFileSync(`${mainDir}/common_params.json`).toString()));
const ignoreParams = JSON5.parse(getNormalizedCase(fs.readFileSync(`${mainDir}/ignore_params.json`).toString()));
const commonSuffixes = JSON5.parse(getNormalizedCase(fs.readFileSync(`${mainDir}/common_suffixes.json`).toString()));
const paramsValidator = new ParamsValidator(commonParams, commonSuffixes);

function main() {
    console.log(`Processing pixels defined in ${mainDir}`);
    const pixelDefs = readPixelDefs(`${mainDir}/pixels`);
    // console.log(pixelDefs);
    // console.log(JSON.stringify(pixelDefs, null, 4));

    // TODO: might be bugs in new tab page pixels. Restore deleted pixels

    readLivePixels(pixelDefs);

    // if (prefix) {
    //     const url = args[3];

    //     console.log('Validating', prefix);
    //     validateSinglePixel(pixelDefs, prefix, url);
    // } else {
    //     if (!clickhouseHost) {
    //         console.error('Please set CLICKHOUSE_HOST in your ENV');
    //         process.exit(1);
    //     }
    //     const pixelQueryResults = queryClickhouse(pixelDefs);
    //     for (const prefix of Object.keys(pixelQueryResults)) {
    //         console.log('Validating', prefix);
    //         validateQueryForPixels(prefix, pixelQueryResults[prefix], paramsValidator);
    //     }
    // }
}

function readPixelDefs(folder) {
    const pixelDefs = {};
    fs.readdirSync(folder, { recursive: true }).forEach((file) => {
        const fullPath = path.join(folder, file);
        if (fs.statSync(fullPath).isDirectory()) {
            return;
        }

        console.log(`Reading pixel def file: ${fullPath}`);
        const filePixes = JSON5.parse(getNormalizedCase(fs.readFileSync(fullPath).toString()));
        for (const prefix of Object.keys(filePixes)) {
            const prefixParts = prefix.split('.');
            console.log(prefixParts);

            var pixelParent = pixelDefs;
            for (var i = 0; i < prefixParts.length-1; i++) {
                const part = prefixParts[i];
                if (!pixelParent[part]) {
                    pixelParent[part] = {};
                }
                pixelParent = pixelParent[part];
            }
            
            const lastPart = prefixParts[prefixParts.length-1];
            if (pixelParent[lastPart]) {
                pixelParent[lastPart][''] = filePixes[prefix];
            } else {
                pixelParent[lastPart] = {'': filePixes[prefix]};
            }
        }
        //process.exit(1);
    });

    return pixelDefs;
}

function readLivePixels(pixelDefs) {
    fs.createReadStream('test.csv')
        .pipe(csv())
        .on('data', (row) => {
            const pixelParts = row.pixel.split('.');
            var pixelMatch = pixelDefs;
            var matchedParts = "";
            for (var i = 0; i < pixelParts.length; i++) {
                const part = pixelParts[i];
                if (pixelMatch[part]) {
                    pixelMatch = pixelMatch[part];
                    matchedParts += part + ".";
                } else {
                    break;
                }
            }

            // TODO: at this point match pixel against '' value
            console.log(row.pixel);
            console.log(matchedParts);
            console.log(pixelMatch);
        })
        .on('end', async () => {
            console.log('CSV file successfully processed');
        });
}

function queryClickhouse(pixelDefs) {
    const agents = "'" + productDef.agents.join("','") + "'";
    const agentString = productDef.agents.length ? `AND agent IN (${agents})` : '';

    const pixelQueryResults = {};
    for (const pixel of Object.keys(pixelDefs)) {
        console.log('Querying for', pixel);
        const pixelID = pixel.split(/[-.]/)[0];
        const queryString = `SELECT DISTINCT request FROM metrics.pixels WHERE pixel_id = '${pixelID}' AND date > now() - INTERVAL 30 DAY AND pixel ILIKE '${pixel}%' AND request NOT ILIKE '%test=1%' ${agentString} LIMIT 1000`;
        const clickhouseQuery = spawnSync('clickhouse-client', ['--host', clickhouseHost, '--query', queryString]);
        const resultString = clickhouseQuery.stdout.toString();
        const resultErr = clickhouseQuery.stderr.toString();
        if (resultErr) {
            console.log('clickhouse query error:', resultErr);
        } else {
            if (resultString) pixelQueryResults[pixel] = resultString;
        }
    }

    return pixelQueryResults;
}

function validateQueryForPixels(prefix, pixelQuery, paramsValidator) {
    const minVersion = productDef.target;

    const lines = pixelQuery.split('\n');
    console.log(`Received ${lines.length} results`);
    for (let line of lines) {
        if (line === '') continue;
        line = getNormalizedCase(line);
        const pixelRequest = line.split('/')[2];
        const pixelDef = pixelDefs[prefix];

        logErrors(`ERROR for '${pixelRequest}\n`, paramsValidator.validateLivePixels(pixelDef, prefix, line, ignoreParams, minVersion));
    }
}

function validateSinglePixel(pixelDefs, prefix, url) {
    logErrors('ERROR:', paramsValidator.validateLivePixels(pixelDefs[prefix], prefix, getNormalizedCase(url)));
}

function getNormalizedCase(value) {
    if (forceLowerCase) {
        return value.toLowerCase();
    }

    return value;
}
main();

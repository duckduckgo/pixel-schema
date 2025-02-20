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
const csvFile = args[1];

const productDef = JSON5.parse(fs.readFileSync(`${mainDir}/product.json`).toString());
// Whether to force all schemas and pixels to lowercase
const forceLowerCase = productDef.forceLowerCase;

const commonParams = JSON5.parse(getNormalizedCase(fs.readFileSync(`${mainDir}/common_params.json`).toString()));
const ignoreParams = JSON5.parse(getNormalizedCase(fs.readFileSync(`${mainDir}/ignore_params.json`).toString()));
const commonSuffixes = JSON5.parse(getNormalizedCase(fs.readFileSync(`${mainDir}/common_suffixes.json`).toString()));
const paramsValidator = new ParamsValidator(commonParams, commonSuffixes);

// TODO: move to global somewhere and detect in pixel defs
const ROOT_PREFIX = 'ROOT_PREFIX';

function main() {
    console.log(`Processing pixels defined in ${mainDir}`);
    const pixelDefs = readPixelDefs(`${mainDir}/pixels`);
    // console.log(pixelDefs);
    // console.log(JSON.stringify(pixelDefs, null, 4));

    // TODO: might be bugs in new tab page pixels. Restore deleted pixels

    console.log('\nValidating live pixels')
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

        console.log(`...Reading pixel def file: ${fullPath}`);
        const filePixes = JSON5.parse(getNormalizedCase(fs.readFileSync(fullPath).toString()));
        for (const prefix of Object.keys(filePixes)) {
            const prefixParts = prefix.split('.');
            // console.log(prefixParts);

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
                pixelParent[lastPart][ROOT_PREFIX] = filePixes[prefix];
            } else {
                pixelParent[lastPart] = {ROOT_PREFIX: filePixes[prefix]};
            }
        }
        //process.exit(1);
    });

    return pixelDefs;
}

function readLivePixels(pixelDefs) {
    const undocumentedPixels = new Set();
    const pixelErrors = {};
    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            // Match longest prefix:
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

            // console.log("--------------------");
            // console.log(row.pixel);
            // console.log(matchedParts);
            //console.log(pixelMatch);

            if (!pixelMatch[ROOT_PREFIX]) {
                undocumentedPixels.add(row.pixel);
                return;
            }

            const prefix = matchedParts.slice(0, -1);

            console.log(`...Validating ${row.pixel}`);
            const errors = paramsValidator.validateLivePixels(pixelMatch[ROOT_PREFIX], prefix, getNormalizedCase(row.request), ignoreParams, productDef.target);
            if (errors.length) {
                if (!pixelErrors[row.pixel]) {
                    pixelErrors[row.pixel] = {
                        errors: new Set(),
                        requests: new Set()
                    }
                }

                pixelErrors[row.pixel].requests.add(row.request);
                for (const error of errors) {
                    pixelErrors[row.pixel].errors.add(error);
                }
            }
        })
        .on('end', async () => {
            console.log(`\nDone validating pixels. Undocumented pixels (${undocumentedPixels.size}):`);
            // console.log(undocumentedPixels);

            console.log('-----------------');
            console.log(pixelErrors);
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

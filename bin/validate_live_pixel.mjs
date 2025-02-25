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
const tokenizedPixels = JSON5.parse(getNormalizedCase(fs.readFileSync(`${mainDir}/tokenized_pixels.json`).toString()));
const paramsValidator = new ParamsValidator(commonParams, commonSuffixes);

function compileDefs(tokenizedPixels) {
    Object.entries(tokenizedPixels).forEach(([prefix, pixelDef]) => {
        if (prefix !== 'ROOT_PREFIX') {
            compileDefs(pixelDef);
            return;
        }

        const combinedParams = pixelDef.parameters
            ? [...pixelDef.parameters, ...Object.values(ignoreParams)]
            : [...Object.values(ignoreParams)];
        const lowerCasedSuffixes = pixelDef.suffixes ? JSON5.parse(JSON.stringify(pixelDef.suffixes).toLowerCase()) : [];

        // Pre-compile each schema
        const paramsSchema = paramsValidator.compileParamsSchema(combinedParams);
        const suffixesSchema = paramsValidator.compileSuffixesSchema(lowerCasedSuffixes);
        tokenizedPixels[prefix] = {
            paramsSchema,
            suffixesSchema
        };
    });
}

function main() {
    console.log(`Processing pixels defined in ${mainDir}`);
    
    compileDefs(tokenizedPixels);
    // console.log(tokenizedPixels);
    // console.log(JSON.stringify(tokenizedPixels, null, 4));


    // console.log('\nValidating live pixels')
    readLivePixels(tokenizedPixels);

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

function readLivePixels(pixelDefs) {
    // COnsider the below to estimate:
    // var exec = require('child_process').exec;

    // exec('wc -l /path/to/file', function (error, results) {
    //     console.log(results);
    // });

    const undocumentedPixels = new Set();
    const pixelErrors = {};
    var processedPixels = 0;
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

            if (!pixelMatch['ROOT_PREFIX']) {
                undocumentedPixels.add(row.pixel);
                return;
            }

            const prefix = matchedParts.slice(0, -1);
            processedPixels++;

            if (processedPixels % 1000 === 0) {
                console.log(`...Processed ${processedPixels} pixels`);
            }

            //console.log(`...Validating ${row.pixel}`);
            const errors = paramsValidator.validateLivePixels(pixelMatch['ROOT_PREFIX'], prefix, row.pixel, getNormalizedCase(row.request), ignoreParams, productDef.target);
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

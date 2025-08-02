#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';

import { getArgParserWithCsv } from '../src/args_utils.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';

import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER, PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';

const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate').parse();
const undocumentedPixels = new Set();
const pixelErrors = {};

function main(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    const productDef = fileUtils.readProductDef(mainDir);
    const experimentsDef = fileUtils.readExperimentsDef(mainDir);
    const commonParams = fileUtils.readCommonParams(mainDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(mainDir);
    const tokenizedPixels = fileUtils.readTokenizedPixels(mainDir);

    const pixelIgnoreParams = fileUtils.readIgnoreParams(mainDir);
    const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
    const ignoreParams = [...(Object.values(pixelIgnoreParams) || []), ...Object.values(globalIgnoreParams)];
    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes, ignoreParams);

    const liveValidator = new LivePixelsValidator(tokenizedPixels, productDef, experimentsDef, paramsValidator);
    let processedPixels = 0;
    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            processedPixels++;
            if (processedPixels % 100000 === 0) {
                console.log(`...Processing row ${processedPixels.toLocaleString('en-US')}...`);
            }
            const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
            const paramsUrlFormat = JSON5.parse(row.params).join('&');
            const result = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat);
            saveResult(pixelRequestFormat, result);
        })
        .on('end', async () => {
            console.log(`\nDone.\nTotal pixels processed: ${processedPixels.toLocaleString('en-US')}`);
            console.log(`Undocumented pixels: ${undocumentedPixels.size.toLocaleString('en-US')}`);

            fs.writeFileSync(fileUtils.getUndocumentedPixelsPath(mainDir), JSON.stringify(Array.from(undocumentedPixels), null, 4));
            fs.writeFileSync(fileUtils.getPixelErrorsPath(mainDir), JSON.stringify(pixelErrors, setReplacer, 4));
            console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);
        });
}

function saveResult(pixelRequestFormat, result) {
    if (result.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED) {
        undocumentedPixels.add(pixelRequestFormat);
    } else if (result.status === PIXEL_VALIDATION_RESULT.VALIDATION_FAILED) {
        const prefix = result.prefixForErrors;
        if (!prefix || !result.errors || !result.errors.length) {
            console.error(`Error: Received invalid result (no prefix or errors) for pixel ${pixelRequestFormat}:`);
            console.error(result);
            process.exit(1);
        }

        if (!pixelErrors[prefix]) {
            pixelErrors[prefix] = {};
        }

        for (const errorWithExample of result.errors) {
            if (!pixelErrors[prefix][errorWithExample.error]) {
                pixelErrors[prefix][errorWithExample.error] = new Set();
            }
            pixelErrors[prefix][errorWithExample.error].add(errorWithExample.example);
        }
    }
}

function setReplacer(_, value) {
    if (value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

main(argv.dirPath, argv.csvFile);

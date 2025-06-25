#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';

import { getArgParserWithCsv } from '../src/args_utils.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator, PixelValidationResult, PixelValidationResultString } from '../src/live_pixel_validator.mjs';

import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';

const KEEP_ALL_ERRORS = false;
const NUM_EXAMPLE_ERRORS= 5; // If KEEP_ALL_ERRORS is false, this is the number of errors to keep per pixel-error combo
const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate').parse();

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

    const uniquePixels = new Set();
    let totalAccesses = 0;

    const pixelSets = {
        [PixelValidationResult.UNDOCUMENTED]: new Set(),
        [PixelValidationResult.OLD_APP_VERSION]: new Set(),
        [PixelValidationResult.VALIDATION_FAILED]: new Set(),
        [PixelValidationResult.VALIDATION_PASSED]: new Set(),
    };

    const accessCounts = {
        [PixelValidationResult.UNDOCUMENTED]: 0,
        [PixelValidationResult.OLD_APP_VERSION]: 0,
        [PixelValidationResult.VALIDATION_FAILED]: 0,
        [PixelValidationResult.VALIDATION_PASSED]: 0,
    };

    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            totalAccesses++;
            if (totalAccesses % 100000 === 0) {
                console.log(`...Processing row ${totalAccesses.toLocaleString('en-US')}...`);
            }
            const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
            const paramsUrlFormat = JSON5.parse(row.params).join('&');
            uniquePixels.add(pixelRequestFormat);

            const ret = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat);

            if (
                ret !== PixelValidationResult.VALIDATION_PASSED &&
                ret !== PixelValidationResult.OLD_APP_VERSION &&
                ret !== PixelValidationResult.UNDOCUMENTED &&
                ret !== PixelValidationResult.VALIDATION_FAILED
            ) {
                console.error(`Unexpected validation result: ${ret} for pixel ${pixelRequestFormat} with params ${paramsUrlFormat}`);
                process.exit(1);
            }
            accessCounts[ret]++;
            pixelSets[ret].add(pixelRequestFormat);
        })
        .on('end', async () => {
            // Two original output lines; is that part of tests?
            // Don't remove for now until tests all passing
            console.log(`\nDone.\nTotal pixels processed: ${totalAccesses.toLocaleString('en-US')}`);
            console.log(`Unique pixels\t${uniquePixels.size.toLocaleString('en-US')} accesses ${totalAccesses.toLocaleString('en-US')}`);

            for (let i = 0; i < Object.keys(PixelValidationResult).length; i++) {
                const numUnique = pixelSets[i].size;
                const numAccesses = accessCounts[i];
                const percentUnique = (numUnique / uniquePixels.size) * 100;
                const percentAccessed = (numAccesses / totalAccesses) * 100;
                console.log(
                    // `${PixelValidationResultString[i]} (unique)\t${unique.toLocaleString('en-US')} percent (${percent.toFixed(2)}%) accesses ${stats[PixelValidationResult[i]].toLocaleString('en-US')} percentAccessed (${percentAccessed.toFixed(2)}%)`,
                    `${PixelValidationResultString[i]}\t unique ${numUnique.toLocaleString('en-US')}\t percent (${percentUnique.toFixed(2)}%)\t accesses ${numAccesses.toLocaleString('en-US')}\t percentAccessed (${percentAccessed.toFixed(2)}%)`,
                );
            }
            // Other stats?
            // Documented pixels not seen?

            try {
                fs.writeFileSync(
                    fileUtils.getUniqueErrorPixelPath(mainDir),
                    //        JSON.stringify(Array.from(liveValidator.undocumentedPixels), null, 4),
                    JSON.stringify(Array.from(pixelSets[PixelValidationResult.VALIDATION_FAILED]), null, 4),
                );
            } catch (err) {
                if (err instanceof RangeError) {
                    console.error(
                        'Error: List of unique pixels with errors is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).',
                    );
                    process.exit(1);
                } else {
                    throw err;
                }
            }

            try {
                fs.writeFileSync(
                    fileUtils.getUndocumentedPixelsPath(mainDir),
                    //        JSON.stringify(Array.from(liveValidator.undocumentedPixels), null, 4),
                    JSON.stringify(Array.from(pixelSets[PixelValidationResult.UNDOCUMENTED]), null, 4),
                );
            } catch (err) {
                if (err instanceof RangeError) {
                    console.error(
                        'Error: List of undocumented pixels is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).',
                    );
                    process.exit(1);
                } else {
                    throw err;
                }
            }

            /*
                This script will fail if there are too many errors to write out the JSON.
                For now we could limit the validation to the last 7 days in 
                clickhouse_fetcher.mjs and that keeps the JSON at an acceptable size. 
                Longer term we can revisit this for a more robust solution.

            */
            try {
                fs.writeFileSync(fileUtils.getPixelErrorsPath(mainDir), JSON.stringify(liveValidator.pixelErrors, setReplacer, 4));
            } catch (err) {
                if (err instanceof RangeError) {
                    console.error(
                        'Error: List of pixel errors is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).',
                    );
                    process.exit(1);
                } else {
                    throw err;
                }
            }
            console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);
        });
}

function setReplacer(_, value) {
    if (value instanceof Set) {
        if (KEEP_ALL_ERRORS) {
            return Array.from(value);
        } else {
            return Array.from(value).slice(0, NUM_EXAMPLE_ERRORS);
        }
    }
    return value;
}

main(argv.dirPath, argv.csvFile);

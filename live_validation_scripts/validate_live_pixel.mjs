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
const NUM_EXAMPLE_ERRORS = 5; // If KEEP_ALL_ERRORS is false, this is the number of errors to keep per pixel-error combo
const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate').parse();

const savedPixelErrors = {};

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
    let totalPixelVariants = 0;

    const pixelSets = {
        [PixelValidationResult.UNDOCUMENTED]: new Set(),
        [PixelValidationResult.OLD_APP_VERSION]: new Set(),
        [PixelValidationResult.VALIDATION_FAILED]: new Set(),
        [PixelValidationResult.VALIDATION_PASSED]: new Set(),
    };

    const variantCounts = {
        [PixelValidationResult.UNDOCUMENTED]: 0,
        [PixelValidationResult.OLD_APP_VERSION]: 0,
        [PixelValidationResult.VALIDATION_FAILED]: 0,
        [PixelValidationResult.VALIDATION_PASSED]: 0,
    };

    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            totalPixelVariants++;
            if (totalPixelVariants % 100000 === 0) {
                console.log(`...Processing row ${totalPixelVariants.toLocaleString('en-US')}...`);
            }
            const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
            const paramsUrlFormat = JSON5.parse(row.params).join('&');
            uniquePixels.add(pixelRequestFormat);

            const lastPixelState = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat);
            const status = lastPixelState.status;

            if (
                status !== PixelValidationResult.VALIDATION_PASSED &&
                status !== PixelValidationResult.OLD_APP_VERSION &&
                status !== PixelValidationResult.UNDOCUMENTED &&
                status !== PixelValidationResult.VALIDATION_FAILED
            ) {
                console.error(`Unexpected validation result: ${status} for pixel ${pixelRequestFormat} with params ${paramsUrlFormat}`);
                process.exit(1);
            }
            variantCounts[status]++;
            pixelSets[status].add(pixelRequestFormat);

            // Collect errors when validation fails
            if (status === PixelValidationResult.VALIDATION_FAILED) {
                const prefix = lastPixelState.prefix;
                
                if (!savedPixelErrors[prefix]) {
                    savedPixelErrors[prefix] = {};
                }
                
                // Collect errors from currentPixelState.errors
                if (lastPixelState.errors) {
                    for (const [errorMessage, examples] of Object.entries(lastPixelState.errors)) {
                        if (!savedPixelErrors[prefix][errorMessage]) {
                            savedPixelErrors[prefix][errorMessage] = new Set();
                        }
                        // Add all examples from this validation
                        examples.forEach(example => savedPixelErrors[prefix][errorMessage].add(example));
                    }
                }
            }
        })
        .on('end', async () => {
            console.log(`\nDone.\nTotal pixels-param variants: ${totalPixelVariants.toLocaleString('en-US')}`);
            console.log(
                `Unique pixels\t${uniquePixels.size.toLocaleString('en-US')} variants ${totalPixelVariants.toLocaleString('en-US')}`,
            );

            // Start at 1 to skip the first value (0).Undefined
            for (let i = 1; i < Object.keys(PixelValidationResult).length; i++) {
                const numUnique = pixelSets[i].size;
                const numVariants = variantCounts[i];
                const percentUnique = (numUnique / uniquePixels.size) * 100;
                const percentAccessed = (numVariants / totalPixelVariants) * 100;
                console.log(
                    // `${PixelValidationResultString[i]} (unique)\t${unique.toLocaleString('en-US')} percentUnique (${percent.toFixed(2)}%) variants ${stats[PixelValidationResult[i]].toLocaleString('en-US')} percentAccessed (${percentAccessed.toFixed(2)}%)`,
                    `${PixelValidationResultString[i]}\t unique ${numUnique.toLocaleString('en-US')}\t percentUnique (${percentUnique.toFixed(2)}%)\t variants ${numVariants.toLocaleString('en-US')}\t percentVariants (${percentAccessed.toFixed(2)}%)`,
                );
            }
            // Other stats?
            // Documented pixels not seen?

            try {
                fs.writeFileSync(
                    fileUtils.getUniqueErrorPixelPath(mainDir),
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
                fs.writeFileSync(fileUtils.getPixelErrorsPath(mainDir), JSON.stringify(savedPixelErrors, setReplacer, 4));
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

#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yaml from 'js-yaml';

import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator, PixelValidationResult } from '../src/live_pixel_validator.mjs';
import { getArgParserValidateLivePixel } from '../src/args_utils.mjs';

import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';

const KEEP_ALL_ERRORS = false;
const NUM_EXAMPLE_ERRORS = 5; // If KEEP_ALL_ERRORS is false, this is the number of errors to keep per pixel-error combo

// pixelMaps includes all pixels, even those that are not accessed and those accessed but not documented
const pixelMap = new Map();

const ownersWithErrors = new Set();

const savedPixelErrors = {};
const pixelsWithErrors = new Set();

const pixelSets = {
    [PixelValidationResult.UNDOCUMENTED]: new Set(),
    [PixelValidationResult.OLD_APP_VERSION]: new Set(),
    [PixelValidationResult.VALIDATION_FAILED]: new Set(),
    [PixelValidationResult.VALIDATION_PASSED]: new Set(),
};

let totalRows = 0;

const argv = getArgParserValidateLivePixel('Validate live pixels').parse();

function getSamplePixelErrors(prefix, numExamples) {
    if (!savedPixelErrors[prefix]) {
        return [];
    }
    const errors = [];
    for (const [errorType, examples] of Object.entries(savedPixelErrors[prefix])) {
        if (numExamples === -1) {
            errors.push({
                type: errorType,
                examples: Array.from(examples),
            });
        } else {
            errors.push({
                type: errorType,
                examples: Array.from(examples).slice(0, numExamples),
            });
        }
    }

    return errors;
}

function readPixelDefs(mainDir, userMap) {
    const pixelDir = path.join(mainDir, 'pixels');

    fs.readdirSync(pixelDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        const pixelsDefs = JSON5.parse(fs.readFileSync(fullPath).toString());

        for (const [name, def] of Object.entries(pixelsDefs)) {
            pixelMap.set(name, {
                owners: def.owners || [],
                numPasses: 0,
                numFailures: 0,
                numAppVersionOutOfDate: 0,
                numAccesses: 0,
                sampleErrors: [],
            });
        }
    });
  
}

async function validateLivePixels(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    console.log('mainDir:', mainDir);

    console.log(`pixelMap size at start of validation/num documented pixels: ${pixelMap.size}`);

    const productDef = fileUtils.readProductDef(mainDir);
    const experimentsDef = fileUtils.readExperimentsDef(mainDir);
    const commonParams = fileUtils.readCommonParams(mainDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(mainDir);
    const pixelIgnoreParams = fileUtils.readIgnoreParams(mainDir);

    const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);

    const ignoreParams = [...(Object.values(pixelIgnoreParams) || []), ...Object.values(globalIgnoreParams)];
    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes, ignoreParams);

    if (!fileUtils.tokenizedPixelsFileExists(mainDir)) {
        console.log(`Error: Tokenized pixels file does not exist`);
        process.exit(1);
    }

    let tokenizedPixels = {};

    try {
        tokenizedPixels = fileUtils.readTokenizedPixels(mainDir);
    } catch (error) {
        console.error('Error reading tokenixed pixels file:', error);
        process.exit(1);
    }

    const liveValidator = new LivePixelsValidator(tokenizedPixels, productDef, experimentsDef, paramsValidator);

    return new Promise((resolve, reject) => {
        if (!fs.existsSync(csvFile)) {
            reject(new Error(`CSV file does not exist: ${csvFile}`));
            return;
        }
        fs.createReadStream(csvFile)
            .pipe(csv())
            .on('data', (row) => {
                if (totalRows % 100000 === 0) {
                    console.log(`...Processing row ${totalRows.toLocaleString('en-US')}...`);
                }
                totalRows++;

                const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
                const paramsUrlFormat = JSON5.parse(row.params).join('&');
                const lastPixelState = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat);
                let pixelName;

                if (lastPixelState.status === PixelValidationResult.UNDOCUMENTED) {
                    // For undocumented pixels, use the full name
                    pixelName = pixelRequestFormat;
                } else {
                    // For documented pixels (including validation failed), use the prefix
                    pixelName = lastPixelState.prefix || pixelRequestFormat;
                }

                const status = lastPixelState.status;

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
                            examples.forEach((example) => savedPixelErrors[prefix][errorMessage].add(example));
                        }
                    }
                }

                pixelSets[status].add(pixelName);

                if (!pixelMap.has(pixelName)) {
                    pixelMap.set(pixelName, {
                        numAccesses: 0,
                        numPasses: 0,
                        numFailures: 0,
                        numAppVersionOutOfDate: 0,
                        numUndocumented: 0,
                    });
                }

                const pixel = pixelMap.get(pixelName);
                pixel.numAccesses++;

                if (status === PixelValidationResult.VALIDATION_PASSED) {
                    pixel.numPasses++;
                } else if (status === PixelValidationResult.VALIDATION_FAILED) {
                    pixel.numFailures++;
                } else if (status === PixelValidationResult.OLD_APP_VERSION) {
                    pixel.numAppVersionOutOfDate++;
                } else if (status === PixelValidationResult.UNDOCUMENTED) {
                    pixel.numUndocumented++;
                } else {
                    console.error(`UNEXPECTED return ${status} for ${pixelName}`);
                    process.exit(1);
                }
            })
            .on('end', async () => {
                console.log(`\nDone.\n`);

                pixelMap.forEach((pixelData, pixelName) => {
                    if (pixelData.numFailures > 0) {
                        pixelData.sampleErrors = getSamplePixelErrors(pixelName, NUM_EXAMPLE_ERRORS);
                    }
                });

                // Find owners with errors
                pixelSets[PixelValidationResult.VALIDATION_FAILED].forEach((pixelName) => {
                    const pixel = pixelMap.get(pixelName);
                    if (pixel) {
                        if (pixel && Array.isArray(pixel.owners)) {
                            pixel.owners.forEach((owner) => {
                                ownersWithErrors.add(owner);
                            });
                        }
                    }
                });

                resolve();
            })
            .on('error', reject);
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

function saveVerificationResults(mainDir) {
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
        } else {
            throw err;
        }
    }

    try {
        fs.writeFileSync(fileUtils.getPixelErrorsPath(mainDir), JSON.stringify(savedPixelErrors, setReplacer, 4));
    } catch (err) {
        if (err instanceof RangeError) {
            console.error('Error: List of pixel errors is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).');
        } else {
            throw err;
        }
    }

    fs.writeFileSync(fileUtils.getOwnersWithErrorsPath(mainDir), JSON.stringify(Array.from(ownersWithErrors), null, 4));

    pixelMap.forEach((pixelData, pixelName) => {
        if (pixelData.sampleErrors && pixelData.sampleErrors.length > 0) {
            pixelsWithErrors.add({ pixelName, pixelData });
        }
    });

    fs.writeFileSync(fileUtils.getPixelsWithErrorsPath(mainDir), JSON.stringify(Array.from(pixelsWithErrors), setReplacer, 4));

    console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);
}

async function main(csvFile, mainDir, userMapFile) {
    console.log(`...Reading user map: ${userMapFile}`);
    if (!fs.existsSync(userMapFile)) {
        console.error(`User map file ${userMapFile} does not exist!`);
        process.exit(1);
    }
    const userMap = yaml.load(fs.readFileSync(userMapFile, 'utf8'));

    console.log(`Reading pixel definitions from ${mainDir}...`);
    readPixelDefs(mainDir, userMap);

    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);
    await validateLivePixels(mainDir, csvFile);

    saveVerificationResults(mainDir);
}

main(argv.csvFile, argv.dirPath, argv.userMapFile);

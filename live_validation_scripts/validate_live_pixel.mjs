#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import yaml from 'js-yaml';

import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator, PixelValidationResult, PixelValidationResultString } from '../src/live_pixel_validator.mjs';

import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';

const KEEP_ALL_ERRORS = false;
const NUM_EXAMPLE_ERRORS = 5; // If KEEP_ALL_ERRORS is false, this is the number of errors to keep per pixel-error combo

// pixelMaps includes all pixels, even those that are not accessed and those accessed but not documented
const pixelMap = new Map();

// uniquePixelsAccessed is a set of all pixels accessed
// Set vs Map
const uniquePixelsAccessed = new Set();

// ownerMap is a map of owner names to a set of pixel names
const ownerMap = new Map();
const allPixelOwners = new Set();

// TODO: This is empty right now - we need to track owners with errors
const ownersWithErrors = new Set();

const savedPixelErrors = {};
const pixelsWithErrors = new Set();

const pixelSets = {
    [PixelValidationResult.UNDOCUMENTED]: new Set(),
    [PixelValidationResult.OLD_APP_VERSION]: new Set(),
    [PixelValidationResult.VALIDATION_FAILED]: new Set(),
    [PixelValidationResult.VALIDATION_PASSED]: new Set(),
};
const unusedPixelDefintions = new Set();
const pixelValidationResults = new Map();

const stats = {
    numPixelDefinitionFiles: 0,
    numPixelDefinitions: 0,

    numValidOwners: 0,
    numPixelOwnersWithErrors: 0,

    totalRows: 0,

    // totalRows = documentedRows + undocumentedRows
    documentedRows: 0,
    undocumentedRows: 0,

    totalPixels: 0,

    // totalPixels = documentedPixels + undocumentedPixels
    undocumentedPixels: 0,
    documentedPixels: 0,

    // totalPixels = accessedPixels + unaccesssedPixels
    accessedPixels: 0,
    // unaccesssedPixels only occur when a documented pixel is not accessed in the validation process
    // we only learn about undocumented pixels if they are accessed
    unaccesssedPixels: 0,

    uniquePixelParamVariants: 0,

    // While each pixel can have multiple validation results
    // Each row has a single validation result
    // Sum over uniquePerSet does not need to equal totalPixels
    // Sum over referencesPerSet does need to equal totalRows
    numSets: 0,
    uniquePerSet: {
        [PixelValidationResult.UNDOCUMENTED]: 0,
        [PixelValidationResult.OLD_APP_VERSION]: 0,
        [PixelValidationResult.VALIDATION_FAILED]: 0,
        [PixelValidationResult.VALIDATION_PASSED]: 0,
    },
    referencesPerSet: {
        [PixelValidationResult.UNDOCUMENTED]: 0,
        [PixelValidationResult.OLD_APP_VERSION]: 0,
        [PixelValidationResult.VALIDATION_FAILED]: 0,
        [PixelValidationResult.VALIDATION_PASSED]: 0,
    },
};

function getArgParser(description) {
    return yargs(hideBin(process.argv))
        .command('$0 csvFile dirPath userMapFile', description, (yargs) => {
            return yargs
                .positional('csvFile', {
                    describe: 'Path to CSV file containing pixels to validate ',
                    type: 'string',
                    demandOption: true,
                })
                .positional('dirPath', {
                    describe: 'path to directory containing the pixels folder and common_[params/suffixes].json in the root',
                    type: 'string',
                    demandOption: true,
                    coerce: (dirPath) => {
                        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
                            throw new Error(`Directory path ${dirPath} does not exist!`);
                        }
                        return dirPath;
                    },
                })
                .positional('userMapFile', {
                    describe: 'Path to user map YAML file',
                    type: 'string',
                    demandOption: true,
                });
        })
        .demandOption('dirPath');
}

const argv = getArgParser('Validate live pixels').parse();

// Produces userMap
function readUserMap(userMapFile) {
    console.log(`...Reading user map: ${userMapFile}`);
    if (!fs.existsSync(userMapFile)) {
        console.error(`User map file ${userMapFile} does not exist!`);
        process.exit(1);
    }
    return yaml.load(fs.readFileSync(userMapFile, 'utf8'));
}

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

function getPixelOwners(pixelsDefs) {
    const owners = [];
    for (const [name, def] of Object.entries(pixelsDefs)) {
        if (def && Array.isArray(def.owners)) {
            def.owners.forEach((owner) => {
                owners.push({ name, owner });
            });
        } else {
            owners.push({ name, owner: 'NO_VALID_OWNER' });
        }
    }
    return owners;
}

function readPixelDefs(mainDir, userMap) {
    const pixelDir = path.join(mainDir, 'pixels');

    fs.readdirSync(pixelDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        stats.numPixelDefinitionFiles++;
        const pixelsDefs = JSON5.parse(fs.readFileSync(fullPath).toString());

        for (const [name, def] of Object.entries(pixelsDefs)) {
            pixelMap.set(name, {
                owners: def.owners || [],
                documented: true,
                numPasses: 0,
                numFailures: 0,
                numAppVersionOutOfDate: 0,
                numAccesses: 0,
                sampleErrors: [],
            });
            stats.numPixelDefinitions++;
        }

        getPixelOwners(pixelsDefs).forEach((pixel) => {
            if (!userMap[pixel.owner]) {
                console.log(`WARNING: Invalid pixel owner: ${pixel.owner} for pixel: ${pixel.name}`);
            } else {
                allPixelOwners.add(pixel.owner);

                if (ownerMap.has(pixel.owner)) {
                    const existingEntry = ownerMap.get(pixel.owner);
                    if (!existingEntry.pixels.includes(pixel.name)) {
                        existingEntry.pixels.push(pixel.name);
                    }
                } else {
                    ownerMap.set(pixel.owner, {
                        asanaId: userMap[pixel.owner].asanaId,
                        pixels: [pixel.name],
                    });
                }
            }
        });
    });

    stats.numValidOwners = ownerMap.size;
    console.log(
        `Processed ${stats.numPixelDefinitionFiles} pixel definition files with a total of ${stats.numPixelDefinitions} pixel definitions.`,
    );
    console.log(`Found ${stats.numValidOwners} unique owners in pixel definitions.`);
}

async function validateLivePixels(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    console.log('mainDir:', mainDir);

    // This will be equal to stats.documentedPixels at the end of validation
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
        // Check if file exists before trying to read it
        if (!fs.existsSync(csvFile)) {
            reject(new Error(`CSV file does not exist: ${csvFile}`));
            return;
        }
        fs.createReadStream(csvFile)
            .pipe(csv())
            .on('data', (row) => {
                if (stats.totalRows % 100000 === 0) {
                    console.log(`...Processing row ${stats.totalRows.toLocaleString('en-US')}...`);
                }
                stats.totalRows++;

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
                uniquePixelsAccessed.add(pixelName);

                // const lastPixelState = liveValidator.validatePixel(pixelName, paramsUrlFormat);
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

                stats.referencesPerSet[status]++;
                pixelSets[status].add(pixelName);

                // Track validation results for each pixel
                if (!pixelValidationResults.has(pixelName)) {
                    pixelValidationResults.set(pixelName, {
                        totalRows: 0,
                        passes: 0,
                        failures: 0,
                        oldAppVersion: 0,
                        undocumented: 0,
                    });
                }
                const pixelResult = pixelValidationResults.get(pixelName);
                pixelResult.totalRows++;

                if (!pixelMap.has(pixelName)) {
                    pixelMap.set(pixelName, {
                        documented: false,
                        numAccesses: 0,
                        numPasses: 0,
                        numFailures: 0,
                        numAppVersionOutOfDate: 0,
                        numUndocumented: 0,
                    });
                }

                const pixel = pixelMap.get(pixelName);
                pixel.numAccesses++;
                if (pixel.documented) {
                    stats.documentedRows++;
                } else {
                    stats.undocumentedRows++;
                }

                // console.log(`pixelName: ${pixelName} full ${pixelRequestFormat} ret: ${ret}`);

                if (status === PixelValidationResult.VALIDATION_PASSED) {
                    pixelResult.passes++;
                    pixel.numPasses++;
                } else if (status === PixelValidationResult.VALIDATION_FAILED) {
                    pixelResult.failures++;
                    pixel.numFailures++;
                } else if (status === PixelValidationResult.OLD_APP_VERSION) {
                    pixelResult.oldAppVersion++;
                    pixel.numAppVersionOutOfDate++;
                } else if (status === PixelValidationResult.UNDOCUMENTED) {
                    pixelResult.undocumented++;
                    pixel.numUndocumented++;
                } else {
                    console.error(`UNEXPECTED return ${status} for ${pixelName}`);
                    process.exit(1);
                }
            })
            .on('end', async () => {
                console.log(`\nDone.\n`);

                stats.totalPixels = pixelMap.size;

                stats.undocumentedPixels = pixelSets[PixelValidationResult.UNDOCUMENTED].size;
                stats.numAppVersionOutOfDatePixels = pixelSets[PixelValidationResult.OLD_APP_VERSION].size;
                stats.numValidationFailedPixels = pixelSets[PixelValidationResult.VALIDATION_FAILED].size;
                stats.numValidationPassedPixels = pixelSets[PixelValidationResult.VALIDATION_PASSED].size;
                stats.accessedPixels = uniquePixelsAccessed.size;
                stats.uniquePixelParamVariants = pixelValidationResults.size; // Total unique pixel-param combinations

                pixelMap.forEach((pixelData, pixelName) => {
                    if (pixelData.documented) {
                        stats.documentedPixels++;
                        if (pixelData.numAccesses === 0) {
                            stats.unaccesssedPixels++;
                            unusedPixelDefintions.add(pixelName);
                        }
                    }

                    if (pixelData.numFailures > 0) {
                        pixelData.sampleErrors = getSamplePixelErrors(pixelName, NUM_EXAMPLE_ERRORS);
                    }
                });

                stats.numSets = Object.keys(PixelValidationResult).length;
                for (let i = 0; i < Object.keys(PixelValidationResult).length; i++) {
                    stats.uniquePerSet[i] = pixelSets[i].size;
                }

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

                resolve({
                    pixelSets,
                    accessCounts: stats.referencesPerSet,
                    totalAccesses: stats.totalRows,
                    uniquePixels: stats.accessedPixels,
                    liveValidator,
                });
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

function printStats(thisStats) {
    console.log('Total access counts:', thisStats.totalRows);
    console.log('Documented accessed:', thisStats.documentedRows);
    console.log('Undocumented accessed:', thisStats.undocumentedRows);
    console.log('Total unique pixels accessed:', thisStats.accessedPixels);
    console.log('Total pixelMap size (includes pixels not accessed):', stats.totalPixels);

    console.log(
        `Unused pixel definitions: ${thisStats.unaccesssedPixels} of ${thisStats.documentedPixels} percent (${((thisStats.unaccesssedPixels / thisStats.documentedPixels) * 100).toFixed(2)}%)`,
    );

    for (let i = 0; i < Object.keys(PixelValidationResult).length; i++) {
        // console.log(`PixelValidationResult[${i}]: ${PixelValidationResultString[i]}`);

        const numUnique = thisStats.uniquePerSet[i];
        const numReferences = thisStats.referencesPerSet[i];
        const percentUnique = (numUnique / thisStats.accessedPixels) * 100;
        const percentReferences = (numReferences / thisStats.totalRows) * 100;
        console.log(
            `${PixelValidationResultString[i]}\t unique ${numUnique.toLocaleString('en-US')}\t percent (${percentUnique.toFixed(2)}%)\t references ${numReferences.toLocaleString('en-US')}\t percent (${percentReferences.toFixed(2)}%)`,
        );
    }
}

function saveVerificationResults(mainDir) {
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

    fs.writeFileSync(fileUtils.getAllOwnersPath(mainDir), JSON.stringify(Array.from(allPixelOwners), null, 4));

    fs.writeFileSync(fileUtils.getOwnersWithErrorsPath(mainDir), JSON.stringify(Array.from(ownersWithErrors), null, 4));

    fs.writeFileSync(fileUtils.getStatsPath(mainDir), JSON.stringify(stats, null, 4));

    pixelMap.forEach((pixelData, pixelName) => {
        if (pixelData.sampleErrors && pixelData.sampleErrors.length > 0) {
            pixelsWithErrors.add({ pixelName, pixelData });
        }
    });

    fs.writeFileSync(fileUtils.getPixelsWithErrorsPath(mainDir), JSON.stringify(Array.from(pixelsWithErrors), setReplacer, 4));

    console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);
}
function verifyStats(thisStats) {
    if (thisStats.totalRows !== thisStats.documentedRows + thisStats.undocumentedRows) {
        console.error('Total rows is not equal to the sum of documented and undocumented rows');
        return false;
    }

    if (thisStats.totalPixels !== thisStats.documentedPixels + thisStats.undocumentedPixels) {
        console.error('Total pixels is not equal to the sum of documented and undocumented pixels');
        return false;
    }

    if (thisStats.totalPixels !== thisStats.documentedPixels + thisStats.undocumentedPixels) {
        console.error('Total pixels is not equal to the sum of documented and undocumentedpixels');
        return false;
    }

    let sum = 0;
    for (const count of Object.values(thisStats.referencesPerSet)) {
        sum += count;
    }

    if (sum !== thisStats.totalRows) {
        console.error('Sum of reference counts is not equal to total rows');
        return false;
    }

    if (thisStats.numSets !== Object.keys(PixelValidationResult).length) {
        console.error('Number of sets is not equal to the number of pixel validation results');
        return false;
    }

    return true;
}
async function main(csvFile, mainDir, userMapFile) {
    console.log('Reading user map...');
    const userMap = readUserMap(userMapFile);

    console.log(`Reading pixel definitions from ${mainDir}...`);
    readPixelDefs(mainDir, userMap);

    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);
    await validateLivePixels(mainDir, csvFile);

    stats.numPixelOwnersWithErrors = ownersWithErrors.size;

    if (!verifyStats(stats)) {
        console.error('ERROR: stats verification failed');
    }

    saveVerificationResults(mainDir);

    console.log('STATS');
    console.log(stats);

    printStats(stats);
}

main(argv.csvFile, argv.dirPath, argv.userMapFile);

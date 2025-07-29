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
const uniquePixelsAccessed = new Set();

// ownerMap is a map of owner names to a set of pixel names
const ownerMap = new Map();
const allPixelOwners = new Set();

//TODO: This is emoty right now -
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


const staticStats = {
    // We get these stats just from the static pixel definitions
    numPixelDefinitionFiles: 0,
    numPixelDefinitions: 0,
    numValidOwners: 0,

}

const liveStats = {

    //We get these stats from live pixel validation
    totalRows: 0,
    documentedRows: 0,
    undocumentedRows: 0,

    numUndocumentedPixels: 0,
    numAppVersionOutOfDatePixels: 0,
    numAccessedPixels: 0,
    numValidationFailedPixels: 0,
    numValidationPassedPixels: 0,
    numPixelParamVariants: 0,
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
            owners.push({ name, owner: 'NO OWNER' });
        }
    }
    return owners;
}


// Produces pixelMap and ownerMap and allPixelOwners and stats
function readPixelDefs(mainDir, userMap) {
    const pixelDir = path.join(mainDir, 'pixels');
   

    fs.readdirSync(pixelDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        staticStats.numPixelDefinitionFiles++;
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
            staticStats.numPixelDefinitions++;
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

    //numPixelDefinitions = stats.numPixelDefinitions;
    ///numPixelDefinitionFiles = stats.numPixelDefinitionFiles;

    staticStats.numValidOwners = ownerMap.size;    
    console.log(`Processed ${staticStats.numPixelDefinitionFiles} pixel definition files with a total of ${staticStats.numPixelDefinitions} pixel definitions.`);
    console.log(`Found ${staticStats.numValidOwners} unique owners in pixel definitions.`);
}


async function validateLivePixels(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    console.log('mainDir:', mainDir);
    console.log(`pixelMap size at start of validation/num documented pixels: ${pixelMap.size}`);
 
    let productDef = {};
    let experimentsDef = {};
    let commonParams = {};
    let commonSuffixes = {};
    let pixelIgnoreParams = {};
    let globalIgnoreParams = {};

    try {
        productDef = fileUtils.readProductDef(mainDir);
        experimentsDef = fileUtils.readExperimentsDef(mainDir);
        commonParams = fileUtils.readCommonParams(mainDir);
        commonSuffixes = fileUtils.readCommonSuffixes(mainDir);

        pixelIgnoreParams = fileUtils.readIgnoreParams(mainDir);

        globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
    } catch (error) {
        console.error('Error reading input files:', error);
        process.exit(1);
    }

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

   

    const referenceCounts = {
        [PixelValidationResult.UNDOCUMENTED]: 0,
        [PixelValidationResult.OLD_APP_VERSION]: 0,
        [PixelValidationResult.VALIDATION_FAILED]: 0,
        [PixelValidationResult.VALIDATION_PASSED]: 0,
    };

    
    return new Promise((resolve, reject) => {
        // Check if file exists before trying to read it
        if (!fs.existsSync(csvFile)) {
            reject(new Error(`CSV file does not exist: ${csvFile}`));
            return;
        }
        fs.createReadStream(csvFile)
            .pipe(csv())
            .on('data', (row) => {
                if (liveStats.totalRows % 100000 === 0) {
                    console.log(`...Processing row ${liveStats.totalRows.toLocaleString('en-US')}...`);
                }
                liveStats.totalRows++;

                const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
                const paramsUrlFormat = JSON5.parse(row.params).join('&');
                let pixelName = liveValidator.getPixelInfo(pixelRequestFormat).prefix;
                if (pixelName === '') {
                    // Get tons of pixels with the wrong delimiter
                    // Example: "email-unsubscribe-mailto"
                    // Track that as the full pixelRequestFormat rather than just ""
                    
                    pixelName = pixelRequestFormat;

                    // The case I see the post is email-*
                    // Worth tracking that special case specifically
                    /*if (pixelRequestFormat.startsWith('email')) {
                        pixelName = 'email';
                    } else {
                        pixelName = pixelRequestFormat;
                    }*/
                }
                uniquePixelsAccessed.add(pixelName);

                const lastPixelState = liveValidator.validatePixel(pixelName, paramsUrlFormat);
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

                referenceCounts[status]++;
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
                    liveStats.documentedRows++;
                } else {
                    liveStats.undocumentedRows++;
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
                    // console.log(liveValidator.getPixelInfo(pixelName).prefix);
                    console.error(`UNEXPECTED return ${status} for ${pixelName}`);
                    process.exit(1);
                }
            })
            .on('end', async () => {
                console.log(`\nDone.\n`);

                console.log('Total access counts:', liveStats.totalRows);
                console.log('Documented accessed:', liveStats.documentedRows);
                console.log('Undocumented accessed:', liveStats.undocumentedRows);
                console.log('Total unique pixels accessed:', uniquePixelsAccessed.size);
                console.log('Total pixelMap size (includes pixels not accessed):', pixelMap.size);

                let pixelDefinitionsUnused = 0;
                let documentedPixels = 0;
                pixelMap.forEach((pixelData, pixelName) => {
                    if (pixelData.documented) {
                        documentedPixels++;
                        if (pixelData.numAccesses === 0) {
                            pixelDefinitionsUnused++;
                            unusedPixelDefintions.add(pixelName);
                        }
                    }

                    if (pixelData.numFailures > 0) {
                        pixelData.sampleErrors = getSamplePixelErrors(pixelName, NUM_EXAMPLE_ERRORS);
                    }
                });
                console.log(
                    `Unused pixel definitions: ${pixelDefinitionsUnused} of ${documentedPixels} percent (${((pixelDefinitionsUnused / documentedPixels) * 100).toFixed(2)}%)`,
                );

                for (let i = 0; i < Object.keys(PixelValidationResult).length; i++) {
                    //console.log(`PixelValidationResult[${i}]: ${PixelValidationResultString[i]}`);

                    const numUnique = pixelSets[i].size;
                    const numAccesses = referenceCounts[i];
                    const percentUnique = (numUnique / uniquePixelsAccessed.size) * 100;
                    const percentAccessed = (numAccesses / liveStats.totalRows) * 100;
                    console.log(
                        `${PixelValidationResultString[i]}\t unique ${numUnique.toLocaleString('en-US')}\t percent (${percentUnique.toFixed(2)}%)\t accesses ${numAccesses.toLocaleString('en-US')}\t percentAccessed (${percentAccessed.toFixed(2)}%)`,
                    );
                }

                // Save validation results
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
                    fs.writeFileSync(
                        fileUtils.getPixelErrorsPath(mainDir),
                        JSON.stringify(savedPixelErrors, setReplacer, 4));
                } catch (err) {
                    if (err instanceof RangeError) {
                        console.error(
                            'Error: List of pixel errors is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).',
                        );
                    } else {
                        throw err;
                    }
                }
                
                fs.writeFileSync(
                    fileUtils.getAllOwnersPath(mainDir),
                    JSON.stringify(Array.from(allPixelOwners), null, 4),
                );

                fs.writeFileSync(
                    fileUtils.getOwnersWithErrorsPath(mainDir),
                    JSON.stringify(Array.from(ownersWithErrors), null, 4),
                );
                
                fs.writeFileSync(
                    fileUtils.getStaticStatsPath(mainDir),
                    JSON.stringify(staticStats, null, 4),
                );
                
                pixelMap.forEach((pixelData, pixelName) => {
                    if (pixelData.sampleErrors && pixelData.sampleErrors.length > 0) {
                        pixelsWithErrors.add({ pixelName, pixelData });
                    }
                });

                fs.writeFileSync(
                    fileUtils.getPixelsWithErrorsPath(mainDir),
                    JSON.stringify(Array.from(pixelsWithErrors), setReplacer, 4)
                );

                console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);

                resolve({
                    pixelSets,
                    accessCounts: referenceCounts,
                    totalAccesses: liveStats.totalRows,
                    uniquePixels: uniquePixelsAccessed.size,
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

function main(csvFile, mainDir, userMapFile) {

    console.log('Reading user map...');
    const userMap = readUserMap(userMapFile);
    
    console.log(`Reading pixel definitions from ${mainDir}...`);
    readPixelDefs(mainDir, userMap);

    console.log('STATIC STATS');
    console.log(staticStats);

    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);
    const validationResults = validateLivePixels(mainDir, csvFile);

    console.log('LIVE STATS');
    console.log(liveStats);
}
/*
    
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
            stats.numPixelParamVariants++;
            if (stats.numPixelParamVariants % 100000 === 0) {
                console.log(`...Processing row ${stats.numPixelParamVariants.toLocaleString('en-US')}...`);
            }
            const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
            const paramsUrlFormat = JSON5.parse(row.params).join('&');
            uniquePixels.add(pixelRequestFormat);

            const lastPixelState = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat);
            const status = lastPixelState.status;

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
                        examples.forEach((example) => savedPixelErrors[prefix][errorMessage].add(example));
                    }
                }
            }
        })
        .on('end', async () => {
            console.log(`\nDone.\nTotal pixels-param variants: ${stats.numPixelParamVariants.toLocaleString('en-US')}`);
            console.log(
                `Unique pixels\t${uniquePixels.size.toLocaleString('en-US')} variants ${stats.numPixelParamVariants.toLocaleString('en-US')}`,
            );

            for (let i = 0; i < Object.keys(PixelValidationResult).length; i++) {
                const numUnique = pixelSets[i].size;
                const numVariants = variantCounts[i];
                const percentUnique = (numUnique / uniquePixels.size) * 100;
                const percentAccessed = (numVariants / stats.numPixelParamVariants) * 100;
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
    */


main(argv.csvFile, argv.dirPath, argv.userMapFile);

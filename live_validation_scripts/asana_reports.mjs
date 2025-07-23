#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import asana from 'asana';
import csv from 'csv-parser';
import yaml from 'js-yaml';

// Add imports for validation functionality
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator, PixelValidationResult, PixelValidationResultString } from '../src/live_pixel_validator.mjs';
import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';
import { preparePixelsCSV } from '../src/clickhouse_fetcher.mjs';

// npm run asana-reports ../duckduckgo-privacy-extension/pixel-definitions/ ../internal-github-asana-utils/user_map.yml 1210584574754345

// TODO: pass in repo name and start/end dates
// TODO: run tokenizer
// TODO: threshold below which we don't report?
// TODO: what if no live pixels? Do we still create a task?

const PIXELS_TMP_CSV = '/tmp/live_pixels.csv';
const USER_MAP_YAML = 'user_map.yml';
const DDG_ASANA_WORKSPACEID = '137249556945';
const DEFAULT_ASANA_PROJECT_ID = '1210584574754345';
// Test Pixel Validation Project: 1210584574754345
// Pixel Validation Project:      1210856607616307
const DAYS_TO_DELETE_ATTACHMENT = 28;

const ownerMap = new Map();
const allPixelOwners = new Set();
const pixelOwnersWithErrors = new Set();
const pixelMap = new Map();
let numPixelDefinitions = 0;
let numPixelDefinitionFiles = 0;

const KEEP_ALL_ERRORS = false;
const NUM_EXAMPLE_ERRORS = 5; // If KEEP_ALL_ERRORS is false, this is the number of errors to keep per pixel-error combo

function getArgParserWithYaml(description, yamlFileDescription) {
    return yargs(hideBin(process.argv))
        .command('$0 dirPath yamlFile asanaProjectID', description, (yargs) => {
            return yargs
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
                .positional('yamlFile', {
                    describe: yamlFileDescription,
                    type: 'string',
                    demandOption: true,
                    default: USER_MAP_YAML,
                })
                .positional('asanaProjectID', {
                    describe: 'ID of the Asana project to create the task in',
                    type: 'string',
                    demandOption: true,
                    default: DEFAULT_ASANA_PROJECT_ID,
                })
                .option('validate', {
                    describe: 'Whether to fetch and validate live pixel data',
                    type: 'boolean',
                    default: false,
                })
                .option('csvFile', {
                    describe: 'Path to CSV file containing pixels to validate (if not provided, will fetch from ClickHouse)',
                    type: 'string',
                });
        })
        .demandOption('dirPath');
}

const argv = getArgParserWithYaml('Validate live pixels and generate reports ').parse();

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

// Produces userMap
function readUserMap(userMapFile) {
    console.log(`...Reading user map: ${userMapFile}`);
    if (!fs.existsSync(userMapFile)) {
        console.error(`User map file ${userMapFile} does not exist!`);
        process.exit(1);
    }
    return yaml.load(fs.readFileSync(userMapFile, 'utf8'));
}

// Produces pixelMap and ownerMap
function readPixelDefs(mainDir, userMap) {
    const pixelDir = path.join(mainDir, 'pixels');
    let numDefFiles = 0;
    let numPixels = 0;

    fs.readdirSync(pixelDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        numDefFiles++;
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
        }

        getPixelOwners(pixelsDefs).forEach((pixel) => {
            if (userMap[pixel.owner]) {
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
            } else {
                console.log(`...Invalid pixel owner: ${pixel.owner} for pixel: ${pixel.name}`);
            }
        });

        numPixels += Object.keys(pixelsDefs).length;
    });

    numPixelDefinitions = numPixels;
    numPixelDefinitionFiles = numDefFiles;

    console.log(`Processed ${numDefFiles} pixel definition files with a total of ${numPixels} pixel definitions.`);
    console.log(`Found ${ownerMap.size} unique owners in pixel definitions.`);
    console.log('BEFORE VALIDATE LIVE PIXELS');
    console.log(JSON.stringify(Array.from(ownerMap), null, 4));
    console.log(JSON.stringify(Array.from(pixelMap), null, 4));
}

async function validateLivePixels(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    console.log('mainDir:', mainDir);
    console.log(`pixelMap size at start of validation: ${pixelMap.size}`);
    // console.log(`First few pixelMap entries:`, Array.from(pixelMap.entries()).slice(0, 3));

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

    const uniquePixels = new Set();
    let totalAccesses = 0;
    let documentedAccesses = 0;
    let undocumentedAccesses = 0;

    const pixelSets = {
        [PixelValidationResult.UNDOCUMENTED]: new Set(),
        [PixelValidationResult.OLD_APP_VERSION]: new Set(),
        [PixelValidationResult.VALIDATION_FAILED]: new Set(),
        [PixelValidationResult.VALIDATION_PASSED]: new Set(),
    };

    const referenceCounts = {
        [PixelValidationResult.UNDOCUMENTED]: 0,
        [PixelValidationResult.OLD_APP_VERSION]: 0,
        [PixelValidationResult.VALIDATION_FAILED]: 0,
        [PixelValidationResult.VALIDATION_PASSED]: 0,
    };

    const unusedPixelDefintions = new Set();

    // Update pixelMap with validation results
    const pixelValidationResults = new Map();

    return new Promise((resolve, reject) => {
        // Check if file exists before trying to read it
        if (!fs.existsSync(csvFile)) {
            reject(new Error(`CSV file does not exist: ${csvFile}`));
            return;
        }
        fs.createReadStream(csvFile)
            .pipe(csv())
            .on('data', (row) => {
                if (totalAccesses % 100000 === 0) {
                    console.log(`...Processing row ${totalAccesses.toLocaleString('en-US')}...`);
                }
                totalAccesses++;

                const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
                const paramsUrlFormat = JSON5.parse(row.params).join('&');
                let pixelName = liveValidator.getPixelPrefix(pixelRequestFormat);
                if (pixelName === '') {
                    // Get tons of pixels with the wrong delimiter
                    // Example: "email-unsubscribe-mailto"
                    // Track that as the full pixelRequestFormat rather than just ""
                    // The case I see the post is email-*
                    // Worth tracking that special case specifically
                    if (pixelRequestFormat.startsWith('email')) {
                        pixelName = 'email';
                    } else {
                        pixelName = pixelRequestFormat;
                    }
                }
                uniquePixels.add(pixelName);

                const ret = liveValidator.validatePixel(pixelName, paramsUrlFormat);

                if (
                    ret !== PixelValidationResult.VALIDATION_PASSED &&
                    ret !== PixelValidationResult.OLD_APP_VERSION &&
                    ret !== PixelValidationResult.UNDOCUMENTED &&
                    ret !== PixelValidationResult.VALIDATION_FAILED
                ) {
                    console.error(`Unexpected validation result: ${ret} for pixel ${pixelName} with params ${paramsUrlFormat}`);
                    process.exit(1);
                }

                referenceCounts[ret]++;
                pixelSets[ret].add(pixelName);

                // Track validation results for each pixel
                if (!pixelValidationResults.has(pixelName)) {
                    pixelValidationResults.set(pixelName, {
                        totalAccesses: 0,
                        passes: 0,
                        failures: 0,
                        oldAppVersion: 0,
                        undocumented: 0,
                    });
                }
                const pixelResult = pixelValidationResults.get(pixelName);
                pixelResult.totalAccesses++;

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
                    documentedAccesses++;
                } else {
                    undocumentedAccesses++;
                }

                // console.log(`pixelName: ${pixelName} full ${pixelRequestFormat} ret: ${ret}`);

                if (ret === PixelValidationResult.VALIDATION_PASSED) {
                    pixelResult.passes++;
                    pixel.numPasses++;
                } else if (ret === PixelValidationResult.VALIDATION_FAILED) {
                    pixelResult.failures++;
                    pixel.numFailures++;
                } else if (ret === PixelValidationResult.OLD_APP_VERSION) {
                    pixelResult.oldAppVersion++;
                    pixel.numAppVersionOutOfDate++;
                } else if (ret === PixelValidationResult.UNDOCUMENTED) {
                    pixelResult.undocumented++;
                    pixel.numUndocumented++;
                } else {
                    // console.log(liveValidator.getPixelPrefix(pixelName));
                    console.error(`UNEXPECTED return ${ret} for ${pixelName}`);
                    process.exit(1);
                }
            })
            .on('end', async () => {
                console.log(`\nDone.\n`);

                console.log('Total access counts:', totalAccesses);
                console.log('Documented accessed:', documentedAccesses);
                console.log('Undocumented accessed:', undocumentedAccesses);
                console.log('Total unique pixels:', uniquePixels.size);
                console.log('Total pixelMap size:', pixelMap.size);

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

                    // TOOD
                    if (pixelData.numFailures > 0) {
                        // pixelData.sampleErrors = liveValidator.getSamplePixelErrors(pixelName, NUM_EXAMPLE_ERRORS);
                        pixelData.sampleErrors = liveValidator.getSamplePixelErrors(pixelName, 1);
                    }
                });
                console.log(
                    `Unused pixel definitions: ${pixelDefinitionsUnused} of ${documentedPixels} percent (${((pixelDefinitionsUnused / documentedPixels) * 100).toFixed(2)}%)`,
                );

                for (let i = 0; i < Object.keys(PixelValidationResult).length; i++) {
                    const numUnique = pixelSets[i].size;
                    const numAccesses = referenceCounts[i];
                    const percentUnique = (numUnique / uniquePixels.size) * 100;
                    const percentAccessed = (numAccesses / totalAccesses) * 100;
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
                    fs.writeFileSync(fileUtils.getPixelErrorsPath(mainDir), JSON.stringify(liveValidator.pixelErrors, setReplacer, 4));
                } catch (err) {
                    if (err instanceof RangeError) {
                        console.error(
                            'Error: List of pixel errors is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).',
                        );
                    } else {
                        throw err;
                    }
                }

                console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);

                resolve({
                    pixelSets,
                    accessCounts: referenceCounts,
                    totalAccesses,
                    uniquePixels: uniquePixels.size,
                    liveValidator,
                });
            })
            .on('error', reject);
    });
}

// TODO
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

function readAsanaNotifyFile(dirPath, userMap, toNotify) {
    const notifyFile = path.join(dirPath, 'asana_notify.json');
    if (!fs.existsSync(notifyFile)) {
        console.log(`Notify file ${dirPath}/asana_notify.json does not exist, will simply add pixel owners as followers `);
        return false;
    }
    const notify = JSON.parse(fs.readFileSync(notifyFile, 'utf8'));
    if (notify.assignee) {
        if (userMap[notify.assignee]) {
            console.log(`...userMap[${notify.assignee}]:`, userMap[notify.assignee]);
            toNotify.assigneeGID = userMap[notify.assignee];
            console.log(`...Assignee ${notify.assignee} found in userMap, GID: ${toNotify.assigneeGID}`);
        } else {
            console.log(`...Invalid user id for assignee: ${notify.assignee} not found in userMap`);
        }
    } else {
        console.log(`...No assignee specified in notify file ${notifyFile}`);
    }

    if (notify.followers) {
        toNotify.followerGIDs = [];
        notify.followers.forEach((followerUsername) => {
            if (userMap[followerUsername]) {
                toNotify.followerGIDs.push(userMap[followerUsername]);
                console.log(`...Follower ${followerUsername} found in userMap, GID: ${userMap[followerUsername]}`);
            } else {
                console.log(`...Invalid follower username: ${followerUsername} not found in userMap`);
            }
        });
        console.log(`...Total followers found: ${toNotify.followerGIDs.length}`);
    } else {
        console.log(`...No followers specified in notify file ${notifyFile}`);
    }

    if (notify.tagPixelOwners) {
        toNotify.tagPixelOwners = notify.tagPixelOwners;
        console.log(`...Add pixel owners as followers to Asana task`);
    } else {
        toNotify.tagPixelOwners = false;
        console.log(`...Do not add pixel owners as followers to Asana task`);
    }

    return true;
}

// Main execution
async function main() {
    // Audit DAYS_TO_FETCH full days in chunks, not including the current day
    const DAYS_TO_FETCH = 7; // Number of days to fetch pixels for; Reduce this (e.g. to 7) if hit limit on JSON size in validate_live_pixel.mjs

    const endDate = new Date();
    // Will get more repeatable results run to run if we don't include current day
    // because the current day is still changing
    endDate.setDate(endDate.getDate() - 1);

    // This sets the time to midnight so we get full days starting at midnight
    // endDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    endDate.setHours(0, 0, 0, 0);

    console.log(`End date ${endDate.toISOString().split('T')[0]}`);

    // Will this work ok across year and month boundaries
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    startDate.setDate(startDate.getDate() - DAYS_TO_FETCH);
    // Ensure pastDate starts at exactly 0:00:00.000
    startDate.setHours(0, 0, 0, 0);

    console.log(`Start date ${startDate.toISOString().split('T')[0]}`);

    const userMap = readUserMap(argv.yamlFile);

    const toNotify = {};
    const success = readAsanaNotifyFile(argv.dirPath, userMap, toNotify);

    if (!success) {
        console.log(`Error: Failed to read asana notify file ${argv.dirPath}/asana_notify.json`);
        process.exit(1);
    }

    console.log('Asana Project ID: ', argv.asanaProjectID);

    // Build the maps of pixel owners and pixels from the Pixel definition files
    readPixelDefs(argv.dirPath, userMap);

    console.log(`Number of pixel definitions found: ${pixelMap.size}`);

    // TODO: Run the tokenizer
    if (!fileUtils.tokenizedPixelsFileExists(argv.dirPath)) {
        console.log(`Error: Tokenized pixels file does not exist`);
        process.exit(1);
    }

    let csvFile = PIXELS_TMP_CSV;

    if (argv.csvFile) {
        csvFile = argv.csvFile;
        console.log(`File exists: ${fs.existsSync(csvFile)}`);
        if (!fs.existsSync(csvFile)) {
            console.error(`CSV File ${csvFile} does not exist!`);
            process.exit(1);
        }
        console.log(`Don't fetch from ClickHouse, using pixel accessdata from${csvFile}...`);
    } else {
        console.log(`Fetching live pixel data from ClickHouse into ${csvFile}...`);

        try {
            await preparePixelsCSV(argv.dirPath, startDate, endDate);
        } catch (error) {
            console.error('Error preparing pixels CSV:', error);
            process.exit(1);
        }
    }

    console.log(`Validating pixels from ${csvFile}...`);
    const validationResults = await validateLivePixels(argv.dirPath, csvFile);

    validationResults.pixelSets[PixelValidationResult.VALIDATION_FAILED].forEach((pixelName) => {
        const pixel = pixelMap.get(pixelName);
        if (pixel) {
            if (pixel && Array.isArray(pixel.owners)) {
                pixel.owners.forEach((owner) => {
                    if (toNotify.tagPixelOwners) {
                        // look up this owner's asana id
                        const ownerGID = userMap[owner];
                        console.log(`...Adding pixel owner ${owner} to notificatin list, found in userMap, GID: ${ownerGID}`);

                        toNotify.followerGIDs.push(userMap[ownerMap]);
                    }
                    pixelOwnersWithErrors.add(owner);
                });
            }
        }
    });

    const report = generateValidationSummary(validationResults);

    await createAsanaTask(report, validationResults, toNotify, argv.asanaProjectID);
}

function generateValidationSummary(validationResults) {
    const { pixelSets, accessCounts, totalAccesses, uniquePixels } = validationResults;

    return {
        totalAccesses,
        uniquePixels,
        validationBreakdown: {
            [PixelValidationResultString[PixelValidationResult.VALIDATION_PASSED]]: {
                unique: pixelSets[PixelValidationResult.VALIDATION_PASSED].size,
                accesses: accessCounts[PixelValidationResult.VALIDATION_PASSED],
            },
            [PixelValidationResultString[PixelValidationResult.VALIDATION_FAILED]]: {
                unique: pixelSets[PixelValidationResult.VALIDATION_FAILED].size,
                accesses: accessCounts[PixelValidationResult.VALIDATION_FAILED],
            },
            [PixelValidationResultString[PixelValidationResult.OLD_APP_VERSION]]: {
                unique: pixelSets[PixelValidationResult.OLD_APP_VERSION].size,
                accesses: accessCounts[PixelValidationResult.OLD_APP_VERSION],
            },
            [PixelValidationResultString[PixelValidationResult.UNDOCUMENTED]]: {
                unique: pixelSets[PixelValidationResult.UNDOCUMENTED].size,
                accesses: accessCounts[PixelValidationResult.UNDOCUMENTED],
            },
        },
    };
}
/* 
function generateOwnerReports() {
    const ownerReports = [];

    ownerMap.forEach((ownerData, ownerName) => {
        const ownerPixels = ownerData.pixels;
        let totalPasses = 0;
        let totalFailures = 0;
        let totalOldAppVersion = 0;
        let documentedPixels = 0;
        let undocumentedPixels = 0;

        ownerPixels.forEach((pixelName) => {
            const pixel = pixelMap.get(pixelName);
            if (pixel) {
                if (pixel.documented) {
                    documentedPixels++;
                    totalPasses += pixel.numPasses;
                    totalFailures += pixel.numFailures;
                    totalOldAppVersion += pixel.numAppVersionOutOfDate;
                } else {
                    undocumentedPixels++;
                }
            }
        });

        ownerReports.push({
            owner: ownerName,
            asanaId: ownerData.asanaId,
            documentedPixels,
            undocumentedPixels,
            totalPasses,
            totalFailures,
            totalOldAppVersion,
            failureRate: totalPasses + totalFailures > 0 ? (totalFailures / (totalPasses + totalFailures)) * 100 : 0,
        });
    });

    return ownerReports;
}
*/

async function createAsanaTask(report, validationResults, toNotify, asanaProjectID) {
    const client = asana.ApiClient.instance;
    const token = client.authentications.token;

    const { pixelSets, accessCounts, totalAccesses, uniquePixels } = validationResults;

    try {
        token.accessToken = fs.readFileSync('/etc/ddg/env/ASANA_DAX_TOKEN', 'utf8');
    } catch (error) {
        console.error('Error reading access token from file:', error);
        process.exit(1);
    }

    const DDG_ASANA_PIXEL_VALIDATION_PROJECT = asanaProjectID;

    console.log('Workspace ID: ' + DDG_ASANA_WORKSPACEID);
    console.log('Pixel Validation Project: ' + DDG_ASANA_PIXEL_VALIDATION_PROJECT);

    const tasks = new asana.TasksApi();

    const taskName = `Pixel Validation Report for ${argv.dirPath}`;

    // Generate HTML table for all documented pixels in pixelMap
    const documentedPixelTableRows = [];
    let documentedPixelCount = 0;
    pixelMap.forEach((pixelData, pixelName) => {
        if (pixelData.documented) {
            documentedPixelCount++;
            const row = `
                    <tr>
                        <td>${pixelName}</td>
                        <td>${pixelData.owners ? pixelData.owners.join(', ') : 'No Owner'}</td>
                        <td>${pixelData.numAccesses}</td>
                        <td>${pixelData.numAppVersionOutOfDate}</td>
                        <td>${pixelData.numPasses}</td>
                        <td>${pixelData.numFailures}</td>
                        <td>${pixelData.sampleErrors ? pixelData.sampleErrors.length : 0}</td>
                    </tr>`;
            documentedPixelTableRows.push(row);
        }
    });

    /*
    const documentedPixelTable =
        documentedPixelTableRows.length > 0
            ? `
                <h2>Documented Pixels</h2>
                <table>
                        <tr>
                            <td><strong>Pixel Name</strong></td>
                            <td><strong>Owners</strong></td>
                            <td><strong>Accesses</strong></td>
                            <td><strong>Old App Version (Unvalidated)</strong></td>
                            <td><strong>Passes</strong></td>
                            <td><strong>Failures</strong></td>
                            <td><strong>Failure Types (See Examples of Each Below)</strong></td>
                        </tr>
             ${documentedPixelTableRows.join('')}
                </table>`
            : 'No pixels found.';
    */

    const undocumentedPixelTableRows = [];
    let undocumentedPixelCount = 0;
    pixelMap.forEach((pixelData, pixelName) => {
        if (!pixelData.documented) {
            undocumentedPixelCount++;
            const row = `
                    <tr>
                        <td>${pixelName}</td>
                        <td>${pixelData.numAccesses}</td>
                        </tr>`;
            undocumentedPixelTableRows.push(row);
        }
    });

    const pixelsWithErrors = new Set();
    pixelMap.forEach((pixelData, pixelName) => {
        if (pixelData.sampleErrors && pixelData.sampleErrors.length > 0) {
            pixelsWithErrors.add({ pixelName, pixelData });
        }
    });

    /*
    const undocumentedPixelTable =
        undocumentedPixelTableRows.length > 0
            ? `
                <h2>Undocumented Pixels</h2>
                <table>
                        <tr>
                            <td><strong>Pixel Name</strong></td>
                            <td><strong>Accesses</strong></td>
                        </tr>
             ${undocumentedPixelTableRows.join('')}
                </table>`
            : 'No pixels found.';
*/

    //   TODO:      ${ documentedPixelTable }

    let header = '';
    if (pixelsWithErrors.size > 0) {
        header = `
                    <h1>TLDR: Pixels you own have errors. Search for your Github username in the attachment for details.  </h1>
                    <ul>
                    <li>Fixes typically involve changes to either the pixel definition or the pixel implementation or both. </li>
                    <li>For changes to the pixel definition, consult the privacy engineering team/ open a privacy triage. </li>
                    <li>Simple changes (e.g. adding a new value to an existing enum, adding a common parameter like appVersion or channel) can be approved quickly and may not require a full privacy triage. </li>
                    <li>More complex changes (e.g. adding a parameter, especially a non-enum parameter) likely will require a privacy triage. </li>
                    <li>Note: The attachment with samples of detailed errors should be deleted after ${DAYS_TO_DELETE_ATTACHMENT} days. </li>
                    </ul>
                    `;
    } else {
        header = `
                    <h1>No errors found. </h1>
                    `;
    }

    // ${undocumentedPixelTable}

    // Note: Accesses add to 100%, but unique pixels may not. Each unique pixel can experience both passes and failures.

    const taskNotes = `<body>
                    ${header}
                    <h2>Background</h2>
                    <ul>
                    <li>This task summarizes pixel mismatches for ${argv.dirPath}.</li>
                    <li>Processed ${numPixelDefinitions} pixel definitions in ${numPixelDefinitionFiles} files.</li>
                    <li>Audited ${uniquePixels} unique pixels and ${totalAccesses} pixel-parameter variants over the last 7 days. </li>
                    <li>There are ${allPixelOwners.size} owners of pixels: ${Array.from(new Set(allPixelOwners)).join(', ')}</li>
                    <li>There are ${pixelOwnersWithErrors.size} owners of pixels with errors: ${Array.from(new Set(pixelOwnersWithErrors)).join(', ')}</li>
                    </ul>
                    <h2>Summary</h2>
                    <table>
                        <tr>
                            <td><strong>Unique Pixels Accessed</strong></td>
                            <td>${uniquePixels}</td>
                        </tr>
                        <tr>
                            <td><strong>Documented Pixels Accessed</strong></td>
                            <td>${documentedPixelCount}</td>
                        </tr>
                        <tr>
                            <td><strong>Undocumented Pixels Accessed</strong></td>
                            <td>${undocumentedPixelCount}</td>
                        </tr>
                        <tr>
                            <td><strong>Documented Pixels Unaccessed</strong></td>
                            <td>${numPixelDefinitions - documentedPixelCount}</td>
                        </tr>
                        </table>

                        <table>
                        <tr>
                            <td></td>
                            <td> <strong>Unique Pixels </strong></td>
                            <td> <strong>Unique Pixel-Param Variants</strong></td>
                            
                        </tr>
                        <tr>
                            <td><strong>Total</strong></td>
                            <td>${uniquePixels}</td>
                            <td>${totalAccesses}</td>
                            
                        </tr>
                        <tr>
                            <td> Undocumented (Not Validated)</td>
                            <td>${pixelSets[PixelValidationResult.UNDOCUMENTED].size}</td>
                            <td>${accessCounts[PixelValidationResult.UNDOCUMENTED]}</td>
                                   </tr>
                         <tr>
                            <td>Old App Version (Not Validated)</td>
                            <td>${pixelSets[PixelValidationResult.OLD_APP_VERSION].size}</td>
                            <td>${accessCounts[PixelValidationResult.OLD_APP_VERSION]}</td>
                            
                        </tr>
                        <tr>
                            <td><strong>Passes</strong></td>
                            <td> ${pixelSets[PixelValidationResult.VALIDATION_PASSED].size}</td>
                            <td>${accessCounts[PixelValidationResult.VALIDATION_PASSED]} </td>
                            
                        </tr>
                        <tr>
                            <td><strong>Failures</strong></td>
                            <td> ${pixelSets[PixelValidationResult.VALIDATION_FAILED].size}</td>
                            <td>${accessCounts[PixelValidationResult.VALIDATION_FAILED]} </td>
                            
                        </tr>
                       
                    </table>

                
                </body>
                `;

    // Check the size of taskNotes
    const taskNotesBytes = Buffer.byteLength(taskNotes, 'utf8');
    console.log(`taskNotes size: ${taskNotesBytes} bytes (${(taskNotesBytes / 1024).toFixed(2)} KB)`);

    // Asana docs are not clear on the limit and neither are the error messages
    // From experience I am guesing the limit is around 35000 bytes, perhaps
    // 32000 bytes to be on the safe side.
    if (taskNotesBytes > 32000) {
        console.error('Details may be too large to send to Asana in the task description itself.');
    }

    // Due date set to when we want to delete any attachments
    const DAYS_UNTIL_DUE = DAYS_TO_DELETE_ATTACHMENT;
    const dueDate = new Date(Date.now() + DAYS_UNTIL_DUE * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
        const taskData = {
            workspace: DDG_ASANA_WORKSPACEID,
            name: taskName,
            due_on: dueDate,
            html_notes: taskNotes,
            text: 'TEST',
            projects: [DDG_ASANA_PIXEL_VALIDATION_PROJECT],
        };

        // Only set assignee if toNotify.assigneeGID exists and is not empty
        if (toNotify.assigneeGID) {
            taskData.assignee = toNotify.assigneeGID;
        }

        // Only set followers if toNotify.followerGIDs exists and has items
        if (toNotify.followerGIDs && toNotify.followerGIDs.length > 0) {
            taskData.followers = toNotify.followerGIDs;
        }

        const body = {
            data: taskData,
        };
        const opts = {};

        console.log(`Creating task for ${argv.dirPath}...`);
        const result = await tasks.createTask(body, opts);
        console.log(`Task created for ${argv.dirPath}: ${result.data.gid}`);

        // Add attachment after task creation if there are pixels with errors
        if (pixelsWithErrors.size > 0) {
            try {
                console.log(`Attempting to attach ${pixelsWithErrors.size} pixels with errors`);

                // Create a temporary file with the pixel error data
                const reportData = JSON.stringify(Array.from(pixelsWithErrors), null, 4);
                const tempFilePath = `/tmp/pixel-errors-${Date.now()}.json`;
                fs.writeFileSync(tempFilePath, reportData);

                const superagent = await import('superagent');

                const attachmentResult = await superagent.default
                    .post('https://app.asana.com/api/1.0/attachments')
                    .set('Authorization', `Bearer ${token.accessToken}`)
                    .field('parent', result.data.gid)
                    .field('name', `pixel-errors-${argv.dirPath.replace(/[^a-zA-Z0-9]/g, '-')}.json`)
                    .attach('file', tempFilePath);

                console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);

                // Clean up temp file
                fs.unlinkSync(tempFilePath);
            } catch (attachmentError) {
                console.error(`Error adding attachment for ${argv.dirPath}:`, attachmentError.message);
                console.error('Full error:', attachmentError);

                /*
                // Fallback: Save locally
                try {
                    const reportData = JSON.stringify(Array.from(pixelsWithErrors), null, 4);
                    const outputPath = `pixel-errors-${Date.now()}.json`;
                    fs.writeFileSync(outputPath, reportData);
                    console.log(`Attachment failed, pixel errors saved to ${outputPath} for manual review`);
                } catch (saveError) {
                    console.error(`Error saving pixel errors to file:`, saveError);
                }
                */
            }
        }
    } catch (error) {
        console.error(`Error creating task for ${argv.dirPath}:`, error);
    }
}

// Run the main function
main().catch(console.error);

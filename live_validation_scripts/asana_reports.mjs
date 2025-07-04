#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import asana from 'asana';
import csv from 'csv-parser';

// Add imports for validation functionality
import { getArgParserWithCsv } from '../src/args_utils.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator, PixelValidationResult, PixelValidationResultString } from '../src/live_pixel_validator.mjs';
import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';
import { preparePixelsCSV } from '../src/clickhouse_fetcher.mjs';

// TODO
//import { PIXELS_TMP_CSV } from '../constants.mjs';
const PIXELS_TMP_CSV = '/tmp/live_pixels.csv';


// npm run asana-reports ../duckduckgo-privacy-extension/pixel-definitions/ ../internal-github-asana-utils/user_map.yml

// import { getPixelOwnerErrorsPath, getInvalidOwnersPath } from '../src/file_utils.mjs';
import yaml from 'js-yaml';

const USER_MAP_YAML = 'user_map.yml';

const ownerMap = new Map();
const pixelMap = new Map();

// Add validation constants
const KEEP_ALL_ERRORS = false;
const NUM_EXAMPLE_ERRORS = 5; // If KEEP_ALL_ERRORS is false, this is the number of errors to keep per pixel-error combo

function getArgParserWithYaml(description, yamlFileDescription) {
    return yargs(hideBin(process.argv))
        .command('$0 dirPath yamlFile', description, (yargs) => {
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

function buildMapsFromPixelDefs(mainDir, userMapFile) {
    const pixelDir = path.join(mainDir, 'pixels');
    let numDefFiles = 0;
    let numPixels = 0;

    console.log(`...Reading user map: ${userMapFile}`);
    const userMap = yaml.load(fs.readFileSync(userMapFile, 'utf8'));

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
                owners: [def.owners],
                documented: true,
                numPasses: 0,
                numFailures: 0,
                numAppVersionOutOfDate: 0,
                numAccesses: 0,
            });
        }

        getPixelOwners(pixelsDefs).forEach((pixel) => {
            if (userMap[pixel.owner]) {
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

    console.log(`Processed ${numDefFiles} pixel definition files with a total of ${numPixels} pixel definitions.`);
    console.log(`Found ${ownerMap.size} unique owners in pixel definitions.`);
    console.log('BEFORE VALIDATE LIVE PIXELS');
    console.log(JSON.stringify(Array.from(ownerMap), null, 4));
    console.log(JSON.stringify(Array.from(pixelMap), null, 4));
}

// Add validation function
async function validateLivePixels(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);
    
    // Debug: Check what's in pixelMap at the start
    console.log('mainDir:', mainDir);
    console.log(`pixelMap size at start of validation: ${pixelMap.size}`);
    //console.log(`First few pixelMap entries:`, Array.from(pixelMap.entries()).slice(0, 3));

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
    let documentedAccesses = 0;
    let undocumentedAccesses = 0;

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

    const unusedPixelDefintions = new Set();

    // Update pixelMap with validation results
    const pixelValidationResults = new Map();

    return new Promise((resolve, reject) => {
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
                if (pixelName === "") {
                    // Get tons of pixels with the wrong delimiter
                    // Example: "email-unsubscribe-mailto"
                    // Track that as the full pixelRequestFormat rather than just ""
                    // The case I see the post is email-*
                    // Worth tracking that special case specifically
                    if (pixelRequestFormat.startsWith("email")) {
                        pixelName = "email";
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
                accessCounts[ret]++;
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

                    //console.log(`pixelName: ${pixelName} full ${pixelRequestFormat} ret: ${ret}`);
                       
                       
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
                });
                console.log(`Unused pixel definitions: ${pixelDefinitionsUnused} of ${documentedPixels} percent (${(pixelDefinitionsUnused / documentedPixels * 100).toFixed(2)}%)`);

                for (let i = 0; i < Object.keys(PixelValidationResult).length; i++) {
                    const numUnique = pixelSets[i].size;
                    const numAccesses = accessCounts[i];
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
                    accessCounts,
                    totalAccesses,
                    uniquePixels: uniquePixels.size,
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

// Main execution
async function main() {
    console.log(`Acceptable owners yamlFile ${argv.yamlFile}`);

    // Build the maps of pixel owners and pixels from the Pixel definition files
    buildMapsFromPixelDefs(argv.dirPath, argv.yamlFile);
    
    console.log(`Number of pixel definitions found: ${pixelMap.size}`);
    
   let csvFile = PIXELS_TMP_CSV;

    if (argv.csvFile) {
        csvFile = argv.csvFile;
        console.log(`File exists: ${fs.existsSync(csvFile)}`);
        if (!fs.existsSync(csvFile)) {
            console.error(`CSV File ${csvFile} does not exist!`);
            process.exit(1);
        }
        console.log(`Don't fetch from ClickHouse, using ${csvFile}...`);

        
    } else {     
        console.log('Fetching pixel data from ClickHouse into ${csvFile}...');
        await preparePixelsCSV(argv.dirPath);
       
    }
    console.log(`Validating pixels from ${csvFile}...`);
    const validationResults = await validateLivePixels(argv.dirPath, csvFile);

        // Generate validation summary for Asana
    const validationSummary = generateValidationSummary(validationResults);
    console.log('Validation Summary:', validationSummary);
    

    console.log('AFTER VALIDATE LIVE PIXELS');
    //console.log(JSON.stringify(Array.from(ownerMap), null, 4));
    console.log(JSON.stringify(Array.from(pixelMap), null, 4));
    
    // Generate owner-based reports
    //const ownerReports = generateOwnerReports();
    //console.log('Owner Reports:', ownerReports);

    // Create Asana tasks for validation issues
    //    await createAsanaTasks(ownerReports);
    
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

function generateOwnerReports() {
    const ownerReports = [];

    ownerMap.forEach((ownerData, ownerName) => {
        const ownerPixels = ownerData.pixels;
        let totalPasses = 0;
        let totalFailures = 0;
        let totalOldAppVersion = 0;
        let documentedPixels = 0;
        let undocumentedPixels = 0;

        ownerPixels.forEach(pixelName => {
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

async function createAsanaTasks(ownerReports) {
    const client = asana.ApiClient.instance;
    const token = client.authentications.token;

    // Get the access token from environment variable
    token.accessToken = process.env.ASANA_ACCESS_TOKEN;

    // Get these from environment variables too
    const workspaceId = process.env.ASANA_DDG_WORKSPACE_ID;
    const pixelValidationProject = process.env.ASANA_PIXEL_VALIDATION_PROJECT;

    console.log('Access Token: ' + token.accessToken);
    console.log('Workspace ID: ' + workspaceId);
    console.log('Pixel Validation Project: ' + pixelValidationProject);

    const tasks = new asana.TasksApi();

    // TODO: Read asana_notify.json file to get the list of users who want to be notified of pixel errors
    const userGID1 = '1202818073638528';
    const userGID2 = '1202096681718068';
    const followers = [userGID1, userGID2];

    // Create tasks for owners with validation issues
    for (const report of ownerReports) {
        if (report.totalFailures > 0 || report.undocumentedPixels > 0) {
            const taskName = `Pixel Validation Issues for ${report.owner}`;
            const taskNotes = `
                <body>
                    <h3>Pixel Validation Report for ${report.owner}</h3>
                    <ul>
                        <li><strong>Documented Pixels:</strong> ${report.documentedPixels}</li>
                        <li><strong>Undocumented Pixels:</strong> ${report.undocumentedPixels}</li>
                        <li><strong>Total Passes:</strong> ${report.totalPasses}</li>
                        <li><strong>Total Failures:</strong> ${report.totalFailures}</li>
                        <li><strong>Old App Version:</strong> ${report.totalOldAppVersion}</li>
                        <li><strong>Failure Rate:</strong> ${report.failureRate.toFixed(2)}%</li>
                    </ul>
                </body>
            `;

            try {
                const body = {
                    data: {
                        workspace: workspaceId,
                        name: taskName,
                        assignee: report.asanaId,
                        due_on: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
                        html_notes: taskNotes,
                        projects: [pixelValidationProject],
                        followers: [followers],
                    },
                };
                const opts = {};

                console.log(`Creating task for ${report.owner}...`);
                const result = await tasks.createTask(body, opts);
                console.log(`Task created for ${report.owner}: ${result.data.gid}`);
            } catch (error) {
                console.error(`Error creating task for ${report.owner}:`, error);
            }
        }
    }
}

// Run the main function
main().catch(console.error);
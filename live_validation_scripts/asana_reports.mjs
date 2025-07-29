#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import asana from 'asana';
import csv from 'csv-parser';
import yaml from 'js-yaml';

import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator, PixelValidationResult, PixelValidationResultString } from '../src/live_pixel_validator.mjs';
import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';
import { preparePixelsCSV } from '../src/clickhouse_fetcher.mjs';

// npm run asana-reports tests/test_data/stats ../internal-github-asana-utils/user_map.yml  1210584574754345
// Test Pixel Validation Project: 1210584574754345
// Pixel Validation Project:      1210856607616307

const DDG_ASANA_WORKSPACEID = '137249556945';
const DAYS_TO_DELETE_ATTACHMENT = 28;

function getArgParser(description) {
    return yargs(hideBin(process.argv))
        .command('$0 dirPath userMapFile asanaProjectID', description, (yargs) => {
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
                .positional('userMapFile', {
                    describe: 'Path to user map YAML file',
                    type: 'string',
                    demandOption: true,
                })
                .positional('asanaProjectID', {
                    describe: 'ID of the Asana project to create the task in',
                    type: 'string',
                    demandOption: true,
                })
        })
        .demandOption('dirPath');
}

const argv = getArgParser('Generate Pixel Validation reports in Asana').parse();


function readUserMap(userMapFile) {
    console.log(`...Reading user map: ${userMapFile}`);
    if (!fs.existsSync(userMapFile)) {
        console.error(`User map file ${userMapFile} does not exist!`);
        process.exit(1);
    }
    return yaml.load(fs.readFileSync(userMapFile, 'utf8'));
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

async function main() {

    const userMap = readUserMap(argv.userMapFile);

    const toNotify = {};
    const success = readAsanaNotifyFile(argv.dirPath, userMap, toNotify);

    if (!success) {
        console.log(`Error: Failed to read asana notify file ${argv.dirPath}/asana_notify.json`);
        process.exit(1);
    }

    console.log('Asana Project ID: ', argv.asanaProjectID);


    //read stats from file
    const statsFilePath = fileUtils.getStaticStatsPath(argv.dirPath);
    console.log(`Reading stats from: ${statsFilePath}`);
    
    if (!fs.existsSync(statsFilePath)) {
        console.error(`Stats file ${statsFilePath} does not exist!`);
        process.exit(1);
    }
    
    let staticStats;
    try {
        const statsData = fs.readFileSync(statsFilePath, 'utf8');
        staticStats = JSON.parse(statsData);
    
    } catch (error) {
        console.error(`Error reading or parsing stats file ${statsFilePath}:`, error);
        process.exit(1);
    }

    let pixelsWithErrors = [];

    const pixelsWithErrorsPath = fileUtils.getPixelsWithErrorsPath(argv.dirPath);
    console.log(`Pixel with errors path from fileUtils: ${pixelsWithErrorsPath}`);

    if (fs.existsSync(pixelsWithErrorsPath)) {
        try {
            const pixelsWithErrorsData = fs.readFileSync(pixelsWithErrorsPath, 'utf8');
            pixelsWithErrors = JSON.parse(pixelsWithErrorsData);


            const pixelNames = Object.keys(pixelsWithErrors);
            console.log(`Successfully loaded pixel with errors object with ${pixelNames.length} pixels`);

        } catch (error) {
            console.error(`Error parsing pixel with errors JSON:`, error);
        }
    } else {
        console.log(`Pixel errors file not found at: ${pixelsWithErrorsPath}`);
    }

 
    console.log("Final number of pixel with errors keys (object):", Object.keys(pixelsWithErrors).length);
    
    //read owners to notify from a file 
    if (toNotify.tagPixelOwners) {
        //read owners to notify from owners_with_errors.json
        const ownersWithErrors = JSON.parse(fs.readFileSync(fileUtils.getOwnersWithErrorsPath(argv.dirPath)));
        console.log(`...Owners with errors: ${ownersWithErrors}`);
        for (const owner of ownersWithErrors) {
            const ownerGID = userMap[owner];
            console.log(`...Adding pixel owner ${owner} to notification list, found in userMap, GID: ${ownerGID}`);

            toNotify.followerGIDs.push(ownerGID);
        }
    }
               
    
    await createAsanaTask(argv.dirPath, staticStats, toNotify, argv.asanaProjectID, pixelsWithErrors);
}


async function createAsanaTask(mainDir, staticStats, toNotify, asanaProjectID, pixelsWithErrors) {
    const client = asana.ApiClient.instance;
    const token = client.authentications.token;

   
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

    console.log(taskName);
   
    let header = '';

    const numPixelsWithErrors = Object.keys(pixelsWithErrors).length;

    if (numPixelsWithErrors > 0) {
        header = `
                    <h1>TLDR: Pixels you own have errors. Search for your Github username in the attachment for details.  </h1>
                    <ul>
                    <li>Fixes typically involve changes to either the pixel definition or the pixel implementation or both. </li>
                    <li>For changes to the pixel definition, consult the privacy engineering team/ open a privacy triage. </li>
                    <li>Simple changes (e.g. adding a new value to an existing enum, adding a common parameter like appVersion or channel) can be approved quickly and may not require a full privacy triage. </li>
                    <li>More complex changes (e.g. adding a parameter, especially a non-enum parameter) likely will require a privacy triage. </li>
                    <li>If you would like more examples of errors, ask in AOR Pixel Registry for help generating a custom report. </li>
                    <li>Note: The attachment with samples of detailed errors should be deleted after ${DAYS_TO_DELETE_ATTACHMENT} days. </li>
                    </ul>
                    `;
    } else {
        header = `
                    <h1>No errors found. </h1>
                    `;
    }
    
   
    // Note: Accesses add to 100%, but unique pixels may not. Each unique pixel can experience both passes and failures.

    /*
    const taskNotes = `<body>
                    ${header}
                    <h2>Background</h2>
                    <ul>
                    <li>This task summarizes pixel mismatches for ${argv.dirPath}.</li>
                    <li>Processed ${staticStats.numPixelDefinitions} pixel definitions in ${staticStats.numPixelDefinitionFiles} files.</li>
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

                */
    
    const taskNotes = `<body>
                    ${header}
                    </body>
                    `;

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
        if (numPixelsWithErrors > 0) {
            try {
                console.log(`Attempting to attach ${numPixelsWithErrors} pixels with errors`);

                // Create a temporary file with the pixel error data
                // TODO: just attach existing pixel_with_errors.json file - no need to create a new one
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
            }
        }

    } catch (error) {
        console.error(`Error creating task for ${argv.dirPath}:`, error);
    }
}

// Run the main function
main().catch(console.error);

#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import asana from 'asana';
import yaml from 'js-yaml';

import * as fileUtils from '../src/file_utils.mjs';

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
                });
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
    console.log('AsanaWorkspace ID: ' + DDG_ASANA_WORKSPACEID);
    const DDG_ASANA_PIXEL_VALIDATION_PROJECT = argv.asanaProjectID;
    console.log('Asana Pixel Validation Project: ', DDG_ASANA_PIXEL_VALIDATION_PROJECT);

    const userMap = readUserMap(argv.userMapFile);

    const toNotify = {};
    const success = readAsanaNotifyFile(argv.dirPath, userMap, toNotify);

    if (!success) {
        console.log(`Error: Failed to read asana notify file ${argv.dirPath}/asana_notify.json`);
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

    console.log('Final number of pixel with errors keys (object):', Object.keys(pixelsWithErrors).length);

    // read owners to notify from a file
    if (toNotify.tagPixelOwners) {
        // read owners to notify from owners_with_errors.json
        const ownersWithErrors = JSON.parse(fs.readFileSync(fileUtils.getOwnersWithErrorsPath(argv.dirPath)));
        console.log(`...Owners with errors: ${ownersWithErrors}`);
        for (const owner of ownersWithErrors) {
            const ownerGID = userMap[owner];
            console.log(`...Adding pixel owner ${owner} to notification list, found in userMap, GID: ${ownerGID}`);

            toNotify.followerGIDs.push(ownerGID);
        }
    }

    const client = asana.ApiClient.instance;
    const token = client.authentications.token;

    try {
        token.accessToken = fs.readFileSync('/etc/ddg/env/ASANA_DAX_TOKEN', 'utf8');
    } catch (error) {
        console.error('Error reading access token from file:', error);
        process.exit(1);
    }

    const tasks = new asana.TasksApi();

    const taskName = `Pixel Validation Report for ${argv.dirPath}`;

    console.log(taskName);

    let topLevelStatement = '';

    const numPixelsWithErrors = Object.keys(pixelsWithErrors).length;

    if (numPixelsWithErrors > 0) {
        topLevelStatement = ` <strong> ${numPixelsWithErrors} pixels with errors.  <a href="https://app.asana.com/1/137249556945/project/1210856607616307/task/1210948723611775?focus=true">View task</a>  </strong>`;
    } else {
        topLevelStatement = `<strong>No errors found. </strong>`;
    }

    const taskNotes = `<body> ${topLevelStatement} </body>`;

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

                const superagent = await import('superagent');

                const attachmentResult = await superagent.default
                    .post('https://app.asana.com/api/1.0/attachments')
                    .set('Authorization', `Bearer ${token.accessToken}`)
                    .field('parent', result.data.gid)
                    .field('name', `pixel_with_errors.json`)
                    .attach('file', pixelsWithErrorsPath);

                console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
            } catch (attachmentError) {
                console.error(`Error adding attachment for ${argv.dirPath}:`, attachmentError.message);
                console.error('Full error:', attachmentError);
            }
        }
    } catch (error) {
        console.error(`Error creating task for ${argv.dirPath}:`, error);
    }
}

main().catch(console.error);

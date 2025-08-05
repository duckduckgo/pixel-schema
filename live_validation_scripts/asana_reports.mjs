#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import asana from 'asana';
import yaml from 'js-yaml';

import * as fileUtils from '../src/file_utils.mjs';
import { getArgParserAsanaReports } from '../src/args_utils.mjs';
import { DDG_ASANA_WORKSPACEID, DAYS_TO_DELETE_ATTACHMENTS } from '../src/constants.mjs';

const MAKE_PER_OWNER_SUBTASKS = true;

const argv = getArgParserAsanaReports('Generate Pixel Validation reports in Asana').parse();
const dirPath = argv.dirPath;
const DDG_ASANA_PIXEL_VALIDATION_PROJECT = argv.asanaProjectID;

const superagent = await import('superagent');

const client = asana.ApiClient.instance;
const token = client.authentications.token;
const tasksApi = new asana.TasksApi();

let pixelsWithErrors = [];
let ownersWithErrors = [];
let userMap = null;

const toNotify = {};

function readAsanaNotifyFile() {
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
        console.log(`...Will Assign per-owner subtasks to pixel owners`);
    }

    return true;
}

async function createOwnerSubtask(owner, parentTaskGid) {
    const thisOwnersPixelsWithErrors = [];
    for (const pixel of Object.values(pixelsWithErrors)) {
        if (pixel.owners && pixel.owners.includes(owner)) {
            thisOwnersPixelsWithErrors.push(pixel);
        }
    }

    if (thisOwnersPixelsWithErrors.length > 0) {
        // Write thisOwnersPixelsWithErrors to a temporary file
        const tempFilePath = path.join(dirPath, `pixel_with_errors_${owner}.json`);
        fs.writeFileSync(tempFilePath, JSON.stringify(thisOwnersPixelsWithErrors, null, 2));

        const subtaskNotes = `<body>
                ${thisOwnersPixelsWithErrors.length} pixels with errors - check the attachment for details.
                New to these reports? See <a href="https://app.asana.com/1/137249556945/project/1210856607616307/task/1210948723611775?focus=true">View task</a>
                </body>`;

        // Make a subtask for each owner
        const subtaskName = `${owner}`;
        const subtaskData = {
            workspace: DDG_ASANA_WORKSPACEID,
            name: subtaskName,
            html_notes: subtaskNotes,
            text: 'Per-owner subtask',
            parent: parentTaskGid,
        };

        if (toNotify.tagPixelOwners) {
            subtaskData.assignee = userMap[owner];
        }

        const subtaskBody = {
            data: subtaskData,
        };

        const opts = {};
        const subtaskResult = await tasksApi.createTask(subtaskBody, opts);
        console.log(`Subtask created for ${owner}: ${subtaskResult.data.gid}`);

        try {
            console.log(`Attempting to attach ${thisOwnersPixelsWithErrors.length} pixels with errors`);

            const attachmentResult = await superagent.default
                .post('https://app.asana.com/api/1.0/attachments')
                .set('Authorization', `Bearer ${token.accessToken}`)
                .field('parent', subtaskResult.data.gid)
                .field('name', `pixel_with_errors_${owner}.json`)
                .attach('file', tempFilePath);

            console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
            fs.unlinkSync(tempFilePath);
        } catch (attachmentError) {
            console.error(`Error adding attachment for ${dirPath}:`, attachmentError.message);
            console.error('Full error:', attachmentError);
        }
    }
}

async function main() {
    console.log('AsanaWorkspace ID: ' + DDG_ASANA_WORKSPACEID);
    console.log('Asana Pixel Validation Project: ', DDG_ASANA_PIXEL_VALIDATION_PROJECT);

    // Load user map
    if (!fs.existsSync(argv.userMapFile)) {
        console.error(`User map file ${argv.userMapFile} does not exist!`);
        process.exit(1);
    }
    userMap = yaml.load(fs.readFileSync(argv.userMapFile, 'utf8'));

    // Save the directory path and load the asana notify file
    const success = readAsanaNotifyFile(dirPath);

    if (!success) {
        console.log(`Error: Failed to read asana notify file ${dirPath}/asana_notify.json`);
        process.exit(1);
    }

    // Load the pixelsWithErrors object
    const pixelsErrorsPath = fileUtils.getPixelErrorsPath(dirPath);
    console.log(`Pixel with errors path from fileUtils: ${pixelsErrorsPath}`);

    if (fs.existsSync(pixelsErrorsPath)) {
        try {
            const pixelErrorsData = fs.readFileSync(pixelsErrorsPath, 'utf8');
            pixelsWithErrors = JSON.parse(pixelErrorsData);

            const pixelNames = Object.keys(pixelsWithErrors);
            console.log(`Successfully loaded pixel with errors object with ${pixelNames.length} pixels`);
        } catch (error) {
            console.error(`Error parsing pixel with errors JSON:`, error);
        }
    } else {
        console.log(`Pixel errors file not found at: ${pixelsErrorsPath}`);
    }

    const numPixelsWithErrors = Object.keys(pixelsWithErrors).length;
    console.log('Final number of pixel with errors keys (object):', numPixelsWithErrors);

    // Build ownersWithErrors from pixelsWithErrors
    const ownersSet = new Set();
    for (const pixel of Object.values(pixelsWithErrors)) {
        if (pixel.owners) {
            pixel.owners.forEach((owner) => ownersSet.add(owner));
        }
    }
    ownersWithErrors = Array.from(ownersSet);
    console.log(`...Owners with errors: ${ownersWithErrors}`);

    // Load the assana access token
    try {
        token.accessToken = fs.readFileSync('/etc/ddg/env/ASANA_DAX_TOKEN', 'utf8');
    } catch (error) {
        console.error('Error reading access token from file:', error);
        process.exit(1);
    }

    // Create the top level Pixel Validation Report task
    const taskName = `Pixel Validation Report for ${dirPath}`;

    console.log(taskName);

    let topLevelStatement = '';

    // For valid formatting options: https://developers.asana.com/docs/rich-text#reading-rich-text
    if (numPixelsWithErrors > 0) {
        topLevelStatement = `${numPixelsWithErrors} pixels with errors - check the attachment for details.
        New to these reports? See <a href="https://app.asana.com/1/137249556945/project/1210856607616307/task/1210948723611775?focus=true">View task</a>
        `;
    } else {
        topLevelStatement = `No errors found.`;
    }

    const taskNotes = `<body> ${topLevelStatement} </body>`;

    // Due date set to when we want to delete any attachments
    const DAYS_UNTIL_DUE = DAYS_TO_DELETE_ATTACHMENTS;
    const dueDate = new Date(Date.now() + DAYS_UNTIL_DUE * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
        // Build taskData
        const taskData = {
            workspace: DDG_ASANA_WORKSPACEID,
            name: taskName,
            due_on: dueDate,
            html_notes: taskNotes,
            text: 'Pixel Validation Report',
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

        // Build body and opts
        const body = {
            data: taskData,
        };
        const opts = {};

        // Create the top level Pixel Validation Report task
        console.log(`Creating task for ${dirPath}...`);
        const result = await tasksApi.createTask(body, opts);

        // Save the resulting taskGID
        const taskGid = result.data.gid;

        console.log(`Task created for ${dirPath}: ${taskGid}`);

        // Add attachment after task creation if there are pixels with errors
        if (numPixelsWithErrors > 0) {
            try {
                const attachmentResult = await superagent.default
                    .post('https://app.asana.com/api/1.0/attachments')
                    .set('Authorization', `Bearer ${token.accessToken}`)
                    .field('parent', taskGid)
                    .field('name', `pixel_with_errors.json`)
                    .attach('file', pixelsErrorsPath);

                console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
            } catch (attachmentError) {
                console.error(`Error adding attachment for ${dirPath}:`, attachmentError.message);
                console.error('Full error:', attachmentError);
            }

            if (MAKE_PER_OWNER_SUBTASKS) {
                // Create subtasks for each owner
                for (const owner of ownersWithErrors) {
                    await createOwnerSubtask(owner, taskGid);
                }
            }
        }
    } catch (error) {
        console.error(`Error creating task for ${dirPath}:`, error);
    }
}

main().catch(console.error);

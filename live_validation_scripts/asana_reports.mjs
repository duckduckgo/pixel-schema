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

    if (!fs.existsSync(argv.userMapFile)) {
        console.error(`User map file ${argv.userMapFile} does not exist!`);
        process.exit(1);
    }
    const userMap = yaml.load(fs.readFileSync(argv.userMapFile, 'utf8'));

    const toNotify = {};
    const success = readAsanaNotifyFile(argv.dirPath, userMap, toNotify);

    if (!success) {
        console.log(`Error: Failed to read asana notify file ${argv.dirPath}/asana_notify.json`);
        process.exit(1);
    }

    let pixelsWithErrors = [];

    const pixelsErrorsPath = fileUtils.getPixelErrorsPath(argv.dirPath);
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

    console.log('Final number of pixel with errors keys (object):', Object.keys(pixelsWithErrors).length);

    // build owners to notify from pixelsWithErrors
    const ownersSet = new Set();
    for (const pixel of Object.values(pixelsWithErrors)) {
        if (pixel.owners) {
            pixel.owners.forEach((owner) => ownersSet.add(owner));
        }
    }
    const ownersWithErrors = Array.from(ownersSet);
    console.log(`...Owners with errors: ${ownersWithErrors}`);

    if (toNotify.tagPixelOwners) {
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

    // For valid formatting options: https://developers.asana.com/docs/rich-text#reading-rich-text
    if (numPixelsWithErrors > 0) {
        topLevelStatement = `
        ${numPixelsWithErrors} pixels with errors - check the attachment for details.
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
                    .attach('file', pixelsErrorsPath);

                console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
            } catch (attachmentError) {
                console.error(`Error adding attachment for ${argv.dirPath}:`, attachmentError.message);
                console.error('Full error:', attachmentError);
            }

            if (MAKE_PER_OWNER_SUBTASKS) {
                // Create subtasks for each owner
                for (const owner of ownersWithErrors) {
                    const thisOwnersPixelsWithErrors = [];
                    for (const pixel of Object.values(pixelsWithErrors)) {
                        if (pixel.owners && pixel.owners.includes(owner)) {
                            thisOwnersPixelsWithErrors.push(pixel);
                        }
                    }
                    // Write thisOwnersPixelsWithErrors to a temporary file
                    const tempFilePath = path.join(argv.dirPath, `pixel_with_errors_${owner}.json`);
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
                        text: 'TEST',
                        parent: result.data.gid,
                    };

                    if (toNotify.tagPixelOwners) {
                        subtaskData.assignee = userMap[owner];
                    }

                    const subtaskBody = {
                        data: subtaskData,
                    };

                    const subtaskResult = await tasks.createTask(subtaskBody, opts);
                    console.log(`Subtask created for ${owner}: ${subtaskResult.data.gid}`);

                    try {
                        console.log(`Attempting to attach ${thisOwnersPixelsWithErrors.length} pixels with errors`);

                        const superagent = await import('superagent');

                        const attachmentResult = await superagent.default
                            .post('https://app.asana.com/api/1.0/attachments')
                            .set('Authorization', `Bearer ${token.accessToken}`)
                            .field('parent', subtaskResult.data.gid)
                            .field('name', `pixel_with_errors_${owner}.json`)
                            .attach('file', tempFilePath);

                        console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
                        fs.unlinkSync(tempFilePath);
                    } catch (attachmentError) {
                        console.error(`Error adding attachment for ${argv.dirPath}:`, attachmentError.message);
                        console.error('Full error:', attachmentError);
                    }
                }
            }
        }
    } catch (error) {
        console.error(`Error creating task for ${argv.dirPath}:`, error);
    }
}

main().catch(console.error);

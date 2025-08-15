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
const usersApi = new asana.UsersApi();

let pixelsWithErrors = [];
let ownersWithErrors = [];
let userMap = null;

const toNotify = {};

// URL to the instructions task in Asanathat explains the report and its contents
const INSTRUCTIONS_TASK_URL = 'https://app.asana.com/1/137249556945/project/1210856607616307/task/1210948723611775?focus=true';
function getPixelFailureMessage(numFailures, isPerOwnerTask) {
    if (numFailures === 0) {
        return `No errors found.`;
    }

    let pixelPhrase = `${numFailures} `;
    pixelPhrase += numFailures === 1 ? ' pixel' : 'pixels';
    if (isPerOwnerTask) {
        pixelPhrase += ' that you own';
    }
    pixelPhrase += numFailures === 1 ? ' has' : ' have';
    pixelPhrase += ' failed live validation.';

    if (isPerOwnerTask) {
        pixelPhrase += ' Table below lists the errors encountered - check the attachment for examples of pixels triggering each error.';
    } else {
        pixelPhrase += ' Check per-owner subtasks and/or the attachment for details.';
    }

    pixelPhrase += ` 

 New to these reports ? See <a href="${INSTRUCTIONS_TASK_URL}">View task</a>`;

    return `${pixelPhrase}`;
}

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

async function getOwnerName(ownersGithubUsername) {
    const ownerGID = userMap[ownersGithubUsername];

    // Get the owner's name from Asana API
    let ownerName = ownersGithubUsername; // fallback to GitHub username
    if (ownerGID) {
        try {
            const userResult = await usersApi.getUser(ownerGID, {});
            ownerName = userResult.data.name || ownersGithubUsername;
            console.log(`Retrieved owner name from Asana: ${ownerName} (${ownersGithubUsername})`);
        } catch (error) {
            console.warn(`Failed to get owner name from Asana for ${ownersGithubUsername} (GID: ${ownerGID}):`, error.message);
            // ownerName remains as GitHub username fallback
        }
    } else {
        console.warn(`Fullname for owner ${ownersGithubUsername} not found, proceed using GitHub username`);
    }

    return ownerName;
}

async function createOwnerSubtask(owner, parentTaskGid) {
    console.log(`Creating subtask for ${owner}...`);

    const ownerName = await getOwnerName(owner);

    const thisOwnersPixelsWithErrors = [];
    for (const [pixelName, pixel] of Object.entries(pixelsWithErrors)) {
        if (pixel.owners && pixel.owners.includes(owner)) {
            thisOwnersPixelsWithErrors.push({ name: pixelName, ...pixel });
        }
    }

    if (thisOwnersPixelsWithErrors.length > 0) {
        // Write thisOwnersPixelsWithErrors to a temporary file
        const tempFilePath = path.join(dirPath, `pixel_with_errors_${owner}.json`);
        fs.writeFileSync(tempFilePath, JSON.stringify(thisOwnersPixelsWithErrors, null, 2));

        const pixelPhrase = getPixelFailureMessage(thisOwnersPixelsWithErrors.length, true);
        const header = `${pixelPhrase}`;

        const pixelNameWidth = 200;
        const errorTypeWidth = 400;

        const table = `
        <table>
           <tr>
            <td data-cell-widths="${pixelNameWidth}"><strong>Pixel Name</strong></td>
            <td data-cell-widths="${errorTypeWidth}"><strong>Error Type</strong></td>
           </tr>
            ${thisOwnersPixelsWithErrors
                .map((pixel) => {
                    // Get error types (excluding 'owners' property) and limit to first 3
                    const allErrorTypes = Object.keys(pixel).filter((key) => key !== 'owners' && key !== 'name');
                    const errorTypes = allErrorTypes.slice(0, 3);

                    // Create rows for each error type
                    const rows = [];
                    errorTypes.forEach((errorType, index) => {
                        /*  
                            We could consider adding the error messages themselves to the table, but
                            1) we want to delete those after DAYS_TO_DELETE_ATTACHMENTS days and that is
                            easier to do with the attachment than the table, and
                            2) It is easier for those looking at these tasks in Asana to reason about what will 
                            be removed and it won't risk removing any edits people might make to the table. 
                            3) we want to keep the table small and readable. 
                            If we did keep the error messages consider truncating them and adding ellipsis of longer than X characters
                        */

                        /*
                            const examples = Array.from(pixel[errorType]);
                            let errorMsg = examples[0];
                            // Truncate to first 150 characters and add ellipsis if longer
                            if (errorMsg.length > 150) {
                                errorMsg = errorMsg.substring(0, 150) + '...';
                            }
                        */

                        // Only show pixel name in the first row
                        const pixelNameCell =
                            index === 0 ? `<td rowspan="${errorTypes.length}" data-cell-widths="${pixelNameWidth}">${pixel.name}</td>` : '';

                        // HTML escape the error type to prevent breaking the table
                        // Escaping single quote ( .replace(/'/g, '&#39;')) results in errorTypes that are munged
                        const escapedErrorType = errorType
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;');

                        rows.push(`<tr>${pixelNameCell}<td data-cell-widths="${errorTypeWidth}">${escapedErrorType}</td></tr>`);
                    });

                    return rows.join('');
                })
                .join('')}
        </table>
        `;
        const taskNotes = `<body> ${header} ${table}</body>`;

        // Make a subtask for each owner
        const subtaskName = `Failing pixels report for ${ownerName}`;
        const subtaskData = {
            workspace: DDG_ASANA_WORKSPACEID,
            name: subtaskName,
            html_notes: taskNotes,
            text: 'Per-owner subtask',
            parent: parentTaskGid,
        };

        if (toNotify.tagPixelOwners) {
            subtaskData.assignee = userMap[owner];
        }

        const subtaskBody = {
            data: subtaskData,
        };

        let subtaskResult = null;
        try {
            const opts = {};
            subtaskResult = await tasksApi.createTask(subtaskBody, opts);
            console.log(`Subtask created for ${owner}: ${subtaskResult.data.gid}`);
        } catch (subtaskError) {
            console.error(`Error creating subtask for ${owner}:`, subtaskError.message);
            console.error('Full error:', subtaskError);
            console.error(`Task notes: ${taskNotes}`);
            return false;
        }

        try {
            const pixelWordForLog = thisOwnersPixelsWithErrors.length === 1 ? 'pixel' : 'pixels';
            console.log(`Attempting to attach ${thisOwnersPixelsWithErrors.length} ${pixelWordForLog} with errors`);

            const attachmentResult = await superagent.default
                .post('https://app.asana.com/api/1.0/attachments')
                .set('Authorization', `Bearer ${token.accessToken}`)
                .field('parent', subtaskResult.data.gid)
                .field('name', `pixel_errors_${owner}.json`)
                .attach('file', tempFilePath);

            console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
            fs.unlinkSync(tempFilePath);
        } catch (attachmentError) {
            console.error(`Error adding attachment for ${dirPath}:`, attachmentError.message);
            console.error('Full error:', attachmentError);
            return false;
        }
    }
    return true;
}

async function main() {
    console.log('AsanaWorkspace ID: ' + DDG_ASANA_WORKSPACEID);
    console.log('Asana Pixel Validation Project: ', DDG_ASANA_PIXEL_VALIDATION_PROJECT);

    let hasErrors = false;

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
    for (const [, pixel] of Object.entries(pixelsWithErrors)) {
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

    const pixelPhrase = getPixelFailureMessage(numPixelsWithErrors, false);

    // For valid formatting options: https://developers.asana.com/docs/rich-text#reading-rich-text
    const taskNotes = `<body> ${pixelPhrase} </body>`;

    // Due date set to when we want to delete any attachments
    const DAYS_UNTIL_DUE = DAYS_TO_DELETE_ATTACHMENTS;
    const dueDate = new Date(Date.now() + DAYS_UNTIL_DUE * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

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
            hasErrors = true;
        }

        // Even if there are no errors, continue to create per-owner subtasks where possible
        if (MAKE_PER_OWNER_SUBTASKS) {
            // Create subtasks for each owner
            for (const owner of ownersWithErrors) {
                const success = await createOwnerSubtask(owner, taskGid);
                if (!success) {
                    console.error(`Error creating subtask for ${owner}`);
                    hasErrors = true;
                }
            }
        }
    }

    if (hasErrors) {
        console.error('There were errors during Asana task creation');
        process.exit(1);
    }

    console.log('Asana tasks created successfully');
    process.exit(0);
}

main().catch(console.error);

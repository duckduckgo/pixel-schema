#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import asana from 'asana';
import yaml from 'js-yaml';

import * as fileUtils from '../src/file_utils.mjs';
import { getArgParserAsanaReports } from '../src/args_utils.mjs';
import { DDG_ASANA_WORKSPACEID, DAYS_TO_DELETE_ATTACHMENTS, ASANA_TASK_PREFIX, ASANA_ATTACHMENT_PREFIX } from '../src/constants.mjs';

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
let ownerToPixelsMap = {};
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
        console.log(`Notify file ${dirPath}/asana_notify.json does not exist, skipping assignees and followers`);
        return;
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

function getAgentFromDirPath(dirPath) {
    if (dirPath.includes('iOS')) {
        return 'ddg_ios';
    } else if (dirPath.includes('android')) {
        return 'ddg_android';
    } else if (dirPath.includes('macOS')) {
        return 'ddg_mac_desktop';
    } else if (dirPath.includes('windows-browser')) {
        return 'ddg_win_desktop';
    } else if (dirPath.includes('duckduckgo-privacy-extension')) {
        return 'Chrome';
    }
    return '';
}

async function createOwnerSubtask(owner, parentTaskGid, ownersPixelData) {
    console.log(`Creating subtask for ${owner}...`);

    const ownerName = await getOwnerName(owner);

    // Write thisOwnersPixelsWithErrors to a temporary file
    const tempFilePath = path.join(dirPath, `${ASANA_ATTACHMENT_PREFIX}_${owner}.json`);
    fs.writeFileSync(tempFilePath, JSON.stringify(ownersPixelData, null, 4));

    const numPixels = Object.keys(ownersPixelData).length;
    const pixelPhrase = getPixelFailureMessage(numPixels, true);
    const header = `${pixelPhrase}`;

    const pixelNameWidth = 200;
    const errorTypeWidth = 400;

    const table = `
        <table>
           <tr>
            <td data-cell-widths="${pixelNameWidth}"><strong>Pixel Name</strong></td>
            <td data-cell-widths="${errorTypeWidth}"><strong>Error Type</strong></td>
           </tr>
            ${Object.entries(ownersPixelData)
                .map(([pixelName, pixel]) => {
                    // Get error types (excluding 'owners' property) and limit to first 3
                    const allErrorTypes = Object.keys(pixel).filter((key) => key !== 'owners');
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

                        const pixelDashboardLink = `https://grafana.duckduckgo.com/d/cfbjqhfosfdvke/pixel-details?orgId=1&var-agent=${getAgentFromDirPath(dirPath)}&var-prefix=${pixelName}&var-owner=All&from=now-10d&to=now`;
                        // Only show pixel name in the first row
                        const pixelNameCell =
                            index === 0
                                ? `<td rowspan="${errorTypes.length}" data-cell-widths="${pixelNameWidth}"><a href="${pixelDashboardLink}" target="_blank">${pixelName}</a></td>`
                                : '';

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
        console.log(`Attempting to attach ${numPixels} ${numPixels === 1 ? 'pixel' : 'pixels'} with errors`);

        const attachmentResult = await superagent.default
            .post('https://app.asana.com/api/1.0/attachments')
            .set('Authorization', `Bearer ${token.accessToken}`)
            .field('parent', subtaskResult.data.gid)
            .field('name', `${ASANA_ATTACHMENT_PREFIX}_${owner}.json`)
            .attach('file', tempFilePath);

        console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
        fs.unlinkSync(tempFilePath);
    } catch (attachmentError) {
        console.error(`Error adding attachment for ${dirPath}:`, attachmentError.message);
        console.error('Full error:', attachmentError);
        return false;
    }

    return true;
}

async function main() {
    console.log('AsanaWorkspace ID: ' + DDG_ASANA_WORKSPACEID);
    console.log('Asana Pixel Validation Project: ', DDG_ASANA_PIXEL_VALIDATION_PROJECT);

    let hasErrors = false;

    // Load the assana access token
    try {
        token.accessToken = fs.readFileSync('/etc/ddg/env/ASANA_DAX_TOKEN', 'utf8');
    } catch (error) {
        console.error('Error reading access token from file:', error);
        process.exit(1);
    }

    // Load user map
    try {
        userMap = yaml.load(fs.readFileSync(argv.userMapFile, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${argv.userMapFile}:`, error);
        process.exit(1);
    }

    // Load the asana notify file
    readAsanaNotifyFile(dirPath);

    // Load the pixelsWithErrors object produced by validate_live_pixel.mjs
    const pixelsErrorsPath = fileUtils.getPixelErrorsPath(dirPath);
    console.log(`Pixel with errors path from fileUtils: ${pixelsErrorsPath}`);

    try {
        const pixelErrorsData = fs.readFileSync(pixelsErrorsPath, 'utf8');
        pixelsWithErrors = JSON.parse(pixelErrorsData);

        const pixelNames = Object.keys(pixelsWithErrors);
        console.log(`Successfully loaded pixel with errors object with ${pixelNames.length} pixels`);
    } catch (error) {
        console.error(`Error parsing pixel with errors JSON:`, error);
        process.exit(1);
    }

    const numPixelsWithErrors = Object.keys(pixelsWithErrors).length;
    console.log('Final number of pixel with errors keys (object):', numPixelsWithErrors);

    // Build ownerToPixelsMap from pixelsWithErrors
    // We could modify validate_live_pixel.mjs to export this format
    ownerToPixelsMap = {};
    for (const [pixelName, pixel] of Object.entries(pixelsWithErrors)) {
        if (pixel.owners && pixel.owners.length > 0) {
            /*
                Notifing only the first owner; Notifying all owners
                risks wasted effort if multiple people work on fixing the same
                pixel in parallel ; First owner can tag others in Asana to help as needed.
            */
            const owner = pixel.owners[0];
            if (!ownerToPixelsMap[owner]) {
                ownerToPixelsMap[owner] = {};
            }

            const pixelData = { ...pixel };
            delete pixelData.owners;

            ownerToPixelsMap[owner][pixelName] = pixelData;
        }
    }

    const ownersWithErrors = Object.keys(ownerToPixelsMap);
    console.log(`...Owners with errors: ${ownersWithErrors}`);

    // Create the top level Pixel Validation Report task
    const currentDateTime = new Date().toISOString().replace('T', ' ').split('.')[0]; // Format: YYYY-MM-DD HH:MM:SS
    const taskName = `${ASANA_TASK_PREFIX} ${dirPath} - ${currentDateTime}`;

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
            /*  
                To avoid deleting attachments used for other purposes
                delete_attachments.mjs looks for attachments that start with ASANA_and end with .json 
                if we change that modify delete_attachments
            */
            const attachmentResult = await superagent.default
                .post('https://app.asana.com/api/1.0/attachments')
                .set('Authorization', `Bearer ${token.accessToken}`)
                .field('parent', taskGid)
                .field('name', `${ASANA_ATTACHMENT_PREFIX}.json`)
                .attach('file', pixelsErrorsPath);

            console.log(`Attachment successfully created: ${attachmentResult.body.data.gid}`);
        } catch (attachmentError) {
            console.error(`Error adding attachment for ${dirPath}:`, attachmentError.message);
            console.error('Full error:', attachmentError);
            hasErrors = true;
        }

        // Even if there are no errors, continue to create per-owner subtasks where possible
        if (MAKE_PER_OWNER_SUBTASKS) {
            for (const [thisOwner, thisOwnerPixelsWithErrors] of Object.entries(ownerToPixelsMap)) {
                const success = await createOwnerSubtask(thisOwner, taskGid, thisOwnerPixelsWithErrors);
                if (!success) {
                    console.error(`Error creating subtask for ${thisOwner}`);
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

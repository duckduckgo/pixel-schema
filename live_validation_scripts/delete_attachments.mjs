#!/usr/bin/env node

import fs from 'fs';
import { fileURLToPath } from 'url';
import asana from 'asana';

import { getArgParserDeleteAttachments } from '../src/args_utils.mjs';
import { DDG_ASANA_WORKSPACEID, DAYS_TO_DELETE_ATTACHMENTS, ASANA_TASK_PREFIX, ASANA_ATTACHMENT_PREFIX } from '../src/constants.mjs';

// Only parse arguments if running as main script
const argv = process.argv[1] === fileURLToPath(import.meta.url) ? getArgParserDeleteAttachments('Delete attachments from Asana').parse() : {};

const cutoffDate = new Date(Date.now() - DAYS_TO_DELETE_ATTACHMENTS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

export function meetsDeletionCriteria(attachment, latestCreationDate) {
    // Attachments can have more detailed error messages with the possibility of some more
    // sensitive/identifying details. We only want to retaun those for  DAYS_TO_DELETE_ATTACHMENTS days
    // If an attachment is older than the cutiff date we should delete it
    const attachmentDate = new Date(attachment.created_at);
    const cutoffDateObj = new Date(cutoffDate);
    const isOldEnough = attachmentDate < cutoffDateObj;

    // People may create other attachments when investigating pixel errors
    // We don't want to delete just any attachments. The ones we are concerned with all
    // start with ASANA_ATTACHMENT_PREFIX and end with .json
    const startsWithPrefix = attachment.name.startsWith(ASANA_ATTACHMENT_PREFIX);
    const endsWithJson = attachment.name.endsWith('.json');

    return isOldEnough && startsWithPrefix && endsWithJson;
}

async function main() {
    console.log('AsanaWorkspace ID: ' + DDG_ASANA_WORKSPACEID);
    const DDG_ASANA_PIXEL_VALIDATION_PROJECT = argv.asanaProjectID;
    console.log('Asana Pixel Validation Project: ', DDG_ASANA_PIXEL_VALIDATION_PROJECT);

    const client = asana.ApiClient.instance;
    const token = client.authentications.token;

    try {
        token.accessToken = fs.readFileSync('/etc/ddg/env/ASANA_DAX_TOKEN', 'utf8');
    } catch (error) {
        console.error('Error reading access token from file:', error);
        process.exit(1);
    }

    const tasks = new asana.TasksApi();
    const attachments = new asana.AttachmentsApi();

    try {
        let numToDelete = 0;
        const attachmentsToDelete = [];

        const result = await tasks.getTasksForProject(DDG_ASANA_PIXEL_VALIDATION_PROJECT, {
            opt_fields: 'name,attachments,attachments.gid,attachments.created_at,attachments.name',
        });
        console.log(`Number of tasks in the project ${DDG_ASANA_PIXEL_VALIDATION_PROJECT}: ${result.data.length}`);

        for (const task of result.data) {
            // Only delete attachments from tasks whose name includes ASANA_TASK_PREFIX
            if (task.name.includes(ASANA_TASK_PREFIX)) {
                console.log(`Task ${task.name} has ${task.attachments.length} attachments`);

                if (task.attachments && task.attachments.length > 0) {
                    task.attachments.forEach((attachment) => {
                        if (meetsDeletionCriteria(attachment, cutoffDate)) {
                            attachmentsToDelete.push({
                                gid: attachment.gid,
                                name: attachment.name,
                                taskName: task.name,
                                createdAt: attachment.created_at,
                            });
                            numToDelete++;
                            console.log(`Adding attachment ${attachment.name} created at ${attachment.created_at} to delete list`);
                        }
                    });
                }

                // Fetch subtasks separately as they are not included in the main task response
                try {
                    const subtasksResult = await tasks.getSubtasksForTask(task.gid, {
                        opt_fields: 'name,attachments,attachments.gid,attachments.created_at,attachments.name',
                    });

                    if (subtasksResult.data && subtasksResult.data.length > 0) {
                        subtasksResult.data.forEach((subtask) => {
                            if (subtask.attachments && subtask.attachments.length > 0) {
                                console.log(`Subtask ${subtask.name} has ${subtask.attachments.length} attachments`);
                                subtask.attachments.forEach((attachment) => {
                                    if (meetsDeletionCriteria(attachment, cutoffDate)) {
                                        attachmentsToDelete.push({
                                            gid: attachment.gid,
                                            name: attachment.name,
                                            taskName: `${task.name} > ${subtask.name}`,
                                            createdAt: attachment.created_at,
                                        });
                                        numToDelete++;
                                        console.log(
                                            `Adding attachment ${attachment.name} created at ${attachment.created_at} to delete list`,
                                        );
                                    }
                                });
                            }
                        });
                    }
                } catch (subtaskError) {
                    console.warn(`Could not fetch subtasks for task ${task.name}: ${subtaskError.message}`);
                }
            }
        }

        console.log('Attachments to delete:', attachmentsToDelete);
        console.log('Number of attachments to delete:', numToDelete);

        if (numToDelete > 0) {
            // If running with --dry-run flag, don't actually delete
            if (argv.dryRun) {
                console.log('🔍 DRY RUN MODE: No attachments will be deleted.');
                return;
            }
            // Actually delete the attachments
            console.log('\n🗑️  Starting deletion process...');
            let deletedCount = 0;
            let errorCount = 0;

            for (const attachment of attachmentsToDelete) {
                try {
                    console.log(`Deleting attachment "${attachment.name}" from task "${attachment.taskName}"...`);
                    await attachments.deleteAttachment(attachment.gid);
                    deletedCount++;
                } catch (error) {
                    errorCount++;
                }

                // Add a small delay to be respectful to the API
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            console.log(`\nDeletion Summary:`);
            console.log(`   Successfully deleted: ${deletedCount}`);
            console.log(`   Failed to delete: ${errorCount}`);
            console.log(`   Total processed: ${deletedCount + errorCount}`);
        } else {
            console.log(`No attachments found to delete`);
        }
    } catch (error) {
        console.error(`Error processing attachments:`, error);
    }
}

// Only run main if this is the script being executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(console.error);
}

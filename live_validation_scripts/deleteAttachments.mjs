#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import asana from 'asana';
import yaml from 'js-yaml';
import readline from 'readline';

import * as fileUtils from '../src/file_utils.mjs';
import { getArgParserDeleteAttachments } from '../src/args_utils.mjs';

const DDG_ASANA_WORKSPACEID = '137249556945';
const DAYS_TO_DELETE_ATTACHMENT = 28;

const argv = getArgParserDeleteAttachments('Delete attachments from Asana').parse();

// Helper function to ask for user confirmation
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
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

    
    const latestCreationDate = new Date(Date.now() - DAYS_TO_DELETE_ATTACHMENT * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
        let numToDelete = 0;
        let attachmentsToDelete = [];

        const result = await tasks.getTasksForProject(DDG_ASANA_PIXEL_VALIDATION_PROJECT, {
            opt_fields: 'name,attachments,attachments.gid,attachments.created_at,attachments.name'
        });
        console.log(`Number of tasks in the project ${DDG_ASANA_PIXEL_VALIDATION_PROJECT}: ${result.data.length}`);

        result.data.forEach(task => {
            if (task.attachments && task.attachments.length > 0) {
                task.attachments.forEach(attachment => {
                    if (attachment.created_at < latestCreationDate) {
                        console.log(`Task: ${task.name}`);
                        console.log(`Attachment: ${attachment.name}`);
                        console.log(`Attachment created at: ${attachment.created_at}`);
                        console.log(`Attachment ID: ${attachment.gid}`);
                        
                        attachmentsToDelete.push({
                            gid: attachment.gid,
                            name: attachment.name,
                            taskName: task.name,
                            createdAt: attachment.created_at
                        });
                        numToDelete++;
                    } 
                    
                    
                });
            } else {
                console.log(`No attachments found for task ${task.name}`);
            }
           

        });
        
        if (numToDelete > 0) {
            // Ask for confirmation before deleting
            console.log(`\n⚠️  WARNING: About to delete ${numToDelete} attachments older than ${DAYS_TO_DELETE_ATTACHMENT} days.`);
            console.log('This action cannot be undone!');
            console.log('Proceed? (y/n)');
            const proceed = await askQuestion('');
            if (proceed !== 'y') {
                console.log('Aborting...');
                return;
            }
            
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
                    console.log(`✅ Successfully deleted attachment ${attachment.gid}`);
                } catch (error) {
                    errorCount++;
                    console.error(`❌ Failed to delete attachment ${attachment.gid}: ${error.message}`);
                }
                
                // Add a small delay to be respectful to the API
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.log(`\nDeletion Summary:`);
            console.log(`   Successfully deleted: ${deletedCount}`);
            console.log(`   Failed to delete: ${errorCount}`);
            console.log(`   Total processed: ${deletedCount + errorCount}`);
            
        }
    } catch (error) {
        console.error(`Error processing attachments:`, error);
    }
}

main().catch(console.error);

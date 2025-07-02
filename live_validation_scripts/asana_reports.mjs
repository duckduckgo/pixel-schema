#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import asana from 'asana';

// npm run asana-reports ../duckduckgo-privacy-extension/pixel-definitions/ ../internal-github-asana-utils/user_map.yml 

// import { getPixelOwnerErrorsPath, getInvalidOwnersPath } from '../src/file_utils.mjs';
import yaml from 'js-yaml';



const USER_MAP_YAML = 'user_map.yml';

const ownerMap = new Map();
const pixelMap = new Map();

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
function buildMaps(mainDir, userMapFile) {
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
                numAppVersionOutOfDate: 0
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
                        pixels: [pixel.name]
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
    console.log(JSON.stringify(Array.from(ownerMap), null, 4));
    console.log(JSON.stringify(Array.from(pixelMap), null, 4));

}

console.log(`YamlFile ${argv.yamlFile}`);

// Build the maps of pixel owners and pixels from the Pixel defintion files
buildMaps(argv.dirPath, argv.yamlFile);

// console.log(ownerMap.get('user').asanaId); 

// Now read through the live pixel data and update the pixelMap with the live data
// including data on undocumented pixels

// Aggregate stats over all pixels - documented and undocumented

// Make an overall report

// Make a repo level report


const client = asana.ApiClient.instance;
const token = client.authentications.token;

// Get the access token from environment variable
// This should not be checked in to repo
token.accessToken = process.env.ASANA_ACCESS_TOKEN; 

// Get these from environment variables too - how do we feel about checking these in?
const workspaceId = process.env.ASANA_DDG_WORKSPACE_ID;
const pixelValidationProject = process.env.ASANA_PIXEL_VALIDATION_PROJECT;


console.log('Access Token: ' + token.accessToken);
console.log('Workspace ID: ' + workspaceId);
console.log('Pixel Validation Project: ' + pixelValidationProject);

// const opts = {};


const tasks = new asana.TasksApi();


const userGID1 = '1202818073638528';
const userGID2 = '1202096681718068';
// const userGID = ownerMap.get('jmatthews').asanaId; // Get the Asana ID for the user from the ownerMap  

// https://developers.asana.com/reference/createtask
/* 
"memberships": [
      {
        "project": {
          "gid": "12345",
          "resource_type": "project",
          "name": "Stuff to buy"
        },
        "section": {
          "gid": "12345",
          "resource_type": "section",
          "name": "Next Actions"
        }
      }
    ],
    "html_notes": "<body>Mittens <em>really</em> likes the stuff from Humboldt.</body>",
    "attachments": [
      {
        "type": "file",
        "name": "humboldt.jpg",
        "url": "https://example.com/humboldt.jpg"
      }
    ]
    */
try {
    const body = {
        data: {
            workspace: workspaceId,
            name: 'New Task Name',
            assignee: userGID1,
            due_on: '2025-07-08', 
            //     notes: 'This is a sample task created via the Asana API.',
            html_notes: "<body>Mittens <em>really</em> likes the stuff from Humboldt.</body>",
            projects: [pixelValidationProject], // Optional: Array of project GIDs to add the task to
            followers: [userGID1, userGID2], // Optional: Array of user GIDs to add as follower

        },
    };
    const opts = {};

    console.log('Create task...');
    tasks.createTask(body, opts).then((result) => {
        console.log('task created', result.data.gid);
        // return createStory(client, result.data.gid, comment, true);
    });
} catch (error) {
    console.error('rejecting promise', error);
}


// Move acess token to environment variable
// const token = process.env.ASANA_ACCESS_TOKEN;

// Make a owner to pixel map

// Make a documented pixel to stats map
// REPO, is used, success, errors

// Make an undocumented pixel to stats map
// REPO, number of times used 

// Aggregate stats over all pixels - documented and undocumented

// Make an overall report

// Make a repo level report

// Make a per owner level report



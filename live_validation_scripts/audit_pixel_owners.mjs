#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { getPixelOwnerErrorsPath, getInvalidOwnersPath } from '../src/file_utils.mjs';
import yaml from 'js-yaml';

const USER_MAP_YAML = 'user_map.yml';

/* 
    validaete_schema.mjs has an optional parameter to verify owners against a user map
    at schema validation time. That is a better place to do it, but this script can be used 
    to audit existing pixel definitions and find any owners that are not in the user map
    later if needed as well.
   */
function getArgParserWithYaml(description, yamlFileDescription) {
    return yargs(hideBin(process.argv))
        .command('$0 [dirPath] [yamlFile]', description, (yargs) => {
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
                    default: USER_MAP_YAML,
                });
        })
        .demandOption('dirPath');
}

const argv = getArgParserWithYaml('audit pixel owners are all github usernames').parse();

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
function auditPixelOwners(mainDir, userMapFile) {
    const invalidOwners = new Set();
    const validOwners = new Set();
    const invalidPixelOwnerPairs = new Set();
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
        getPixelOwners(pixelsDefs).forEach((pixel) => {
            if (!userMap[pixel.owner]) {
                invalidPixelOwnerPairs.add({
                    pixel: pixel.name,
                    owner: pixel.owner,
                });
                invalidOwners.add(pixel.owner);
            } else {
                validOwners.add(pixel.owner);
            }
        });

        numPixels += Object.keys(pixelsDefs).length;
    });

    console.log(`Processed ${numDefFiles} pixel definition files with a total of ${numPixels} pixel definitions.`);

    // TODO: make an Asana task for each valid pixel owner with any errors in their pixels
    console.log('Number of unique valid pixel owners:', validOwners.size);

    console.log('Number of unique invalid owners:', invalidOwners.size);
    let outFile = getInvalidOwnersPath(mainDir);
    console.log(`Writing out invalid owner names to ${outFile}`);
    fs.writeFileSync(outFile, JSON.stringify(Array.from(invalidOwners), null, 4));

    console.log('Total pixel owner errors:', invalidPixelOwnerPairs.size);
    outFile = getPixelOwnerErrorsPath(mainDir);
    console.log(`Writing out pixel owner errors to ${outFile}`);
    fs.writeFileSync(outFile, JSON.stringify(Array.from(invalidPixelOwnerPairs), null, 4));
}
console.log(`YamlFile ${argv.yamlFile}`);
auditPixelOwners(argv.dirPath, argv.yamlFile);

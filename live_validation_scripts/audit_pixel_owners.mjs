#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { getPixelOwnerErrorsPath } from '../src/file_utils.mjs';
import yaml from 'js-yaml';

const USER_MAP_YAML = 'user_map.yml';

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
        }
    }
    return owners;
}
function auditPixelOwners(mainDir, userMapFile) {
    const invalidOwners = new Set();
    const pixelDir = path.join(mainDir, 'pixels');

    console.log(`...Reading user map: ${userMapFile}`);
    const userMap = yaml.load(fs.readFileSync(userMapFile, 'utf8'));

    fs.readdirSync(pixelDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        const pixelsDefs = JSON5.parse(fs.readFileSync(fullPath).toString());
        getPixelOwners(pixelsDefs).forEach((pixel) => {
            console.log(`...Processing pixel: ${pixel.name} (${pixel.owner})`);
            if (!userMap[pixel.owner]) {
                console.warn(`Pixel ${pixel.name} (${pixel.owner}) does not have a valid owner
defined in ${userMapFile}`);
                invalidOwners.add({
                    pixel: pixel.name,
                    owner: pixel.owner,
                });
            } else {
                console.log(`Pixel ${pixel.name} (${pixel.owner}) has a valid owner.`);
            }
        });
    });

    // Write out tokenized pixel defs to a file
    const outFile = getPixelOwnerErrorsPath(mainDir);
    console.log(`Writing out pixel owner errors to ${outFile}`);
    fs.writeFileSync(outFile, JSON.stringify(Array.from(invalidOwners), null, 4));
}
console.log(`YamlFile ${argv.yamlFile}`);
auditPixelOwners(argv.dirPath, argv.yamlFile);

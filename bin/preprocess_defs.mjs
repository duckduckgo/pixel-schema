#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';

import { hideBin } from 'yargs/helpers';

// TODO: move to global somewhere and detect in pixel defs
const ROOT_PREFIX = 'ROOT_PREFIX';
const combinedPixelDefs = {};

const argv = yargs(hideBin(process.argv))
    .command('$0 [dirPath] [outFile]', 'preprocess (tokenize) pixel definitions', (yargs) => {
        return yargs.positional('dirPath', {
                describe: 'path to directory containing the pixels folder and common_[params/suffixes].json in the root',
                type: 'string',
                demandOption: true,
                coerce: (dirPath) => {
                    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
                        throw new Error(`Directory path ${dirPath} does not exist!`);
                    }
                    return dirPath;
                },
            }).positional('outFile', {
                describe: 'output file for tokenized pixels',
                type: 'string',
                default: 'tokenized_pixels.json'
            });
    })
    .demandOption('dirPath')
    .parse();

function processPixelFile(pixelDefs) {
    for (const prefix of Object.keys(pixelDefs)) {
        const prefixParts = prefix.split('.');

        var pixelParent = combinedPixelDefs;
        for (var i = 0; i < prefixParts.length-1; i++) {
            const part = prefixParts[i];
            if (!pixelParent[part]) {
                pixelParent[part] = {};
            }
            pixelParent = pixelParent[part];
        }
        
        const lastPart = prefixParts[prefixParts.length-1];

        if (pixelParent[lastPart]) {
            if (pixelParent[lastPart][ROOT_PREFIX]) {
                // Should not happen (we assume valid defs at this point):
                throw new Error(`Duplicate pixel definition found for ${prefix}`);
            }

            pixelParent[lastPart][ROOT_PREFIX] = pixelDefs[prefix];
        } else {
            pixelParent[lastPart] = {ROOT_PREFIX: pixelDefs[prefix]};
        }
    }
}

function processPixelDefs(folder) {
    fs.readdirSync(folder, { recursive: true }).forEach((file) => {
        const fullPath = path.join(folder, file);
        if (fs.statSync(fullPath).isDirectory()) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        const pixelsFile = JSON5.parse(fs.readFileSync(fullPath).toString());
        processPixelFile(pixelsFile);
    });

    // Write out tokenized pixel defs to a file
    console.log(`Writing out tokenized pixel defs to ${argv.outFile}`);
    fs.writeFileSync(argv.outFile, JSON.stringify(combinedPixelDefs, null, 4));
}

processPixelDefs(path.join(argv.dirPath, 'pixels'));
